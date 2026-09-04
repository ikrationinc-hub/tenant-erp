import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDbPool } from "../../../config/db.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { stockMovements } from "../../../database/tenant/schema.js";
import { ConflictError } from "../../../common/errors/index.js";
import { consumeReservation, releaseReservation, reserveFromLot } from "../reserve-allocate.js";
import { findStockLotById } from "../stock-lots.repository.js";
import { seedLot, seedLotFixture, type SeededLotFixture } from "./test-fixtures.js";

const TEST_TIMEOUT_MS = 120_000;

// Single shared teardown for the whole file - closeTenantDbPool/closeDbPool
// close process-wide singleton pools, so calling them from more than one
// describe block's own afterAll would close an already-closed pool out
// from under whichever describe block runs second.
afterAll(async () => {
  await closeTenantDbPool();
  await closeDbPool();
});

describe("core/inventory-lots: reserveFromLot concurrency (S-2's own acceptance gate)", () => {
  /**
   * THE concurrency test, run 10 times per S-2's own explicit instruction.
   * Each iteration seeds a FRESH lot with receivedQty=50, fires 100
   * concurrent reserveFromLot calls each requesting qty 1 - each call opens
   * its OWN transaction via withTenantSchema (mirroring next-number.test.ts's
   * exact concurrency-proving shape: a fresh connection/transaction per
   * call, not one shared transaction), so any pass here is due to the row
   * lock itself, never accidental serialization from sharing a connection.
   * Exactly 50 must succeed (reservedQty reaches receivedQty exactly) and
   * 50 must reject with the over-allocation ConflictError - a rejection is
   * caught and collected, never left to short-circuit Promise.all.
   */
  for (let iteration = 1; iteration <= 10; iteration += 1) {
    it(
      `iteration ${iteration}: 100 concurrent reserveFromLot(qty=1) calls against a lot of receivedQty=50 - exactly 50 succeed, 50 reject, reservedQty ends at exactly 50.000000`,
      async () => {
        const fixture: SeededLotFixture = await seedLotFixture(`lot-concurrency-${iteration}`);
        const lot = await seedLot(fixture, "50");

        const CONCURRENCY = 100;
        const outcomes = await Promise.all(
          Array.from({ length: CONCURRENCY }, () =>
            withTenantSchema(fixture.schemaName, (tx) =>
              reserveFromLot(tx, {
                lotId: lot.id,
                qty: "1",
                referenceType: "test_reservation",
                referenceId: randomUUID(),
                createdBy: fixture.userId,
              }),
            )
              .then((reservation) => ({ ok: true as const, reservation }))
              .catch((error: unknown) => ({ ok: false as const, error })),
          ),
        );

        const succeeded = outcomes.filter((o) => o.ok);
        const rejected = outcomes.filter((o) => !o.ok);

        expect(succeeded.length).toBe(50);
        expect(rejected.length).toBe(50);
        for (const failure of rejected) {
          if (failure.ok) continue;
          expect(failure.error).toBeInstanceOf(ConflictError);
        }

        const finalLot = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
        expect(finalLot?.reservedQty).toBe("50.000000");
        expect(finalLot?.deliveredQty).toBe("0.000000");
      },
      TEST_TIMEOUT_MS,
    );
  }
});

describe("core/inventory-lots: reserveFromLot / releaseReservation / consumeReservation", () => {
  it(
    "reserve decreases available by exactly qty; release restores it exactly",
    async () => {
      const fixture = await seedLotFixture("reserve-release");
      const lot = await seedLot(fixture, "100");

      const reservation = await withTenantSchema(fixture.schemaName, (tx) =>
        reserveFromLot(tx, { lotId: lot.id, qty: "30", referenceType: "test_reservation", referenceId: randomUUID(), createdBy: fixture.userId }),
      );

      const afterReserve = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
      expect(afterReserve?.reservedQty).toBe("30.000000");

      await withTenantSchema(fixture.schemaName, (tx) => releaseReservation(tx, reservation.id));

      const afterRelease = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
      expect(afterRelease?.reservedQty).toBe("0.000000");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "releasing an already-released reservation throws instead of silently no-op-ing",
    async () => {
      const fixture = await seedLotFixture("double-release");
      const lot = await seedLot(fixture, "100");

      const reservation = await withTenantSchema(fixture.schemaName, (tx) =>
        reserveFromLot(tx, { lotId: lot.id, qty: "10", referenceType: "test_reservation", referenceId: randomUUID(), createdBy: fixture.userId }),
      );
      await withTenantSchema(fixture.schemaName, (tx) => releaseReservation(tx, reservation.id));

      await expect(withTenantSchema(fixture.schemaName, (tx) => releaseReservation(tx, reservation.id))).rejects.toThrow(ConflictError);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "full consumption converts a reservation into a negative sale_delivery stock_movements row; lot counters move from reservedQty to deliveredQty",
    async () => {
      const fixture = await seedLotFixture("consume-full");
      const lot = await seedLot(fixture, "100");
      const referenceId = randomUUID();

      const reservation = await withTenantSchema(fixture.schemaName, (tx) =>
        reserveFromLot(tx, { lotId: lot.id, qty: "40", referenceType: "test_reservation", referenceId, createdBy: fixture.userId }),
      );

      const { movement } = await withTenantSchema(fixture.schemaName, (tx) =>
        consumeReservation(tx, reservation.id, { qty: "40", movementDate: "2024-07-01", createdBy: fixture.userId }),
      );

      expect(movement.movementType).toBe("sale_delivery");
      expect(movement.quantity).toBe("-40.000000");
      expect(movement.referenceType).toBe("test_reservation");
      expect(movement.referenceId).toBe(referenceId);

      const finalLot = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
      expect(finalLot?.reservedQty).toBe("0.000000");
      expect(finalLot?.deliveredQty).toBe("40.000000");

      // Sum of movements for this lot's item/warehouse equals -deliveredQty.
      const movementRows = await withTenantSchema(fixture.schemaName, (tx) =>
        tx.select().from(stockMovements).where(eq(stockMovements.referenceId, referenceId)),
      );
      const total = movementRows.reduce((sum, row) => sum + Number(row.quantity), 0);
      expect(total).toBe(-40);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "partial consumption: two consumeReservation calls against the same reservation, summing to less than its qty, both succeed and leave it un-consumedAt",
    async () => {
      const fixture = await seedLotFixture("consume-partial");
      const lot = await seedLot(fixture, "100");
      const referenceId = randomUUID();

      const reservation = await withTenantSchema(fixture.schemaName, (tx) =>
        reserveFromLot(tx, { lotId: lot.id, qty: "50", referenceType: "test_reservation", referenceId, createdBy: fixture.userId }),
      );

      await withTenantSchema(fixture.schemaName, (tx) => consumeReservation(tx, reservation.id, { qty: "20", movementDate: "2024-07-01", createdBy: fixture.userId }));
      const midLot = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
      expect(midLot?.reservedQty).toBe("30.000000");
      expect(midLot?.deliveredQty).toBe("20.000000");

      await withTenantSchema(fixture.schemaName, (tx) => consumeReservation(tx, reservation.id, { qty: "15", movementDate: "2024-07-02", createdBy: fixture.userId }));
      const finalLot = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
      expect(finalLot?.reservedQty).toBe("15.000000");
      expect(finalLot?.deliveredQty).toBe("35.000000");

      const movementRows = await withTenantSchema(fixture.schemaName, (tx) =>
        tx.select().from(stockMovements).where(eq(stockMovements.referenceId, referenceId)),
      );
      expect(movementRows.length).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a reservation cannot be consumed for more than its own remaining (unconsumed) qty",
    async () => {
      const fixture = await seedLotFixture("consume-overshoot");
      const lot = await seedLot(fixture, "100");

      const reservation = await withTenantSchema(fixture.schemaName, (tx) =>
        reserveFromLot(tx, { lotId: lot.id, qty: "20", referenceType: "test_reservation", referenceId: randomUUID(), createdBy: fixture.userId }),
      );

      await withTenantSchema(fixture.schemaName, (tx) => consumeReservation(tx, reservation.id, { qty: "12", movementDate: "2024-07-01", createdBy: fixture.userId }));

      // Only 8 remains unconsumed (20 - 12) - requesting 9 must reject.
      await expect(
        withTenantSchema(fixture.schemaName, (tx) => consumeReservation(tx, reservation.id, { qty: "9", movementDate: "2024-07-02", createdBy: fixture.userId })),
      ).rejects.toThrow(ConflictError);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reserving more than is available (over-allocation) rejects with a ConflictError naming the exact available amount",
    async () => {
      const fixture = await seedLotFixture("over-allocate");
      const lot = await seedLot(fixture, "10");

      await expect(
        withTenantSchema(fixture.schemaName, (tx) =>
          reserveFromLot(tx, { lotId: lot.id, qty: "11", referenceType: "test_reservation", referenceId: randomUUID(), createdBy: fixture.userId }),
        ),
      ).rejects.toThrow(/Only 10 available/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "interleaved-transaction invariant: two concurrent reservations that together exceed availability never push reservedQty + deliveredQty above receivedQty",
    async () => {
      const fixture = await seedLotFixture("interleaved");
      const lot = await seedLot(fixture, "10");

      // X=7 and Y=8 together (15) exceed the 10 available - exactly one
      // must succeed since 7+7=14 > 10 but 7 alone <= 10 and no combination
      // of (succeed, succeed) is possible without violating the lot's own
      // capacity; the second call blocks on the first's row lock until it
      // commits, then re-reads the updated counters and (correctly)
      // rejects.
      const outcomes = await Promise.all([
        withTenantSchema(fixture.schemaName, (tx) =>
          reserveFromLot(tx, { lotId: lot.id, qty: "7", referenceType: "test_reservation", referenceId: randomUUID(), createdBy: fixture.userId }),
        )
          .then(() => ({ ok: true as const }))
          .catch(() => ({ ok: false as const })),
        withTenantSchema(fixture.schemaName, (tx) =>
          reserveFromLot(tx, { lotId: lot.id, qty: "8", referenceType: "test_reservation", referenceId: randomUUID(), createdBy: fixture.userId }),
        )
          .then(() => ({ ok: true as const }))
          .catch(() => ({ ok: false as const })),
      ]);

      const successCount = outcomes.filter((o) => o.ok).length;
      expect(successCount).toBe(1);

      const finalLot = await withTenantSchema(fixture.schemaName, (tx) => findStockLotById(tx, lot.id));
      const invariant = Number(finalLot?.reservedQty) + Number(finalLot?.deliveredQty);
      expect(invariant).toBeLessThanOrEqual(10);
    },
    TEST_TIMEOUT_MS,
  );
});
