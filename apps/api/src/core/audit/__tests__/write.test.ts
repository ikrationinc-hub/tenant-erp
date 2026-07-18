import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDbPool } from "../../../config/db.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { auditLogs, companies } from "../../../database/tenant/schema.js";
import { computeDiff, insertAuditLog } from "../write.js";

const TEST_TIMEOUT_MS = 120_000;

/** drizzle-orm wraps the driver's Postgres error as `.cause`, not the top-level message vitest's toThrow checks by default. */
async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => {
    const cause = error instanceof Error ? error.cause : undefined;
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    return /permission denied/i.test(causeMessage);
  });
}

interface SeededCompany {
  tenant: ProvisionedTenant;
  companyId: string;
}

async function seedCompany(label: string): Promise<SeededCompany> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const companyId = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        name: `${label} Co`,
        countryCode: "US",
        currencyCode: "USD",
        fiscalYearStartMonth: 1,
        timezone: "America/New_York",
        createdBy: randomUUID(),
      })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    return company.id;
  });

  return { tenant, companyId };
}

describe("core/audit", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });

  describe("computeDiff", () => {
    it("keeps only keys whose value actually changed", () => {
      const result = computeDiff(
        { name: "Acme", creditLimit: 1000, active: true },
        { name: "Acme", creditLimit: 2000, active: true },
      );
      expect(result.before).toEqual({ creditLimit: 1000 });
      expect(result.after).toEqual({ creditLimit: 2000 });
    });

    it("treats a missing `before` as a pure create - no diffing", () => {
      const result = computeDiff(undefined, { name: "Acme" });
      expect(result.before).toBeUndefined();
      expect(result.after).toEqual({ name: "Acme" });
    });

    it("treats a missing `after` as a pure delete - no diffing", () => {
      const result = computeDiff({ name: "Acme" }, undefined);
      expect(result.before).toEqual({ name: "Acme" });
      expect(result.after).toBeUndefined();
    });

    it("returns empty objects when nothing changed", () => {
      const result = computeDiff({ name: "Acme" }, { name: "Acme" });
      expect(result.before).toEqual({});
      expect(result.after).toEqual({});
    });
  });

  it(
    "a business transaction rollback leaves no orphan audit row",
    async () => {
      const { tenant, companyId } = await seedCompany("audit-rollback");
      const entityId = randomUUID();

      await expect(
        withTenantSchema(tenant.schemaName, async (tx) => {
          await insertAuditLog(tx, {
            companyId,
            entity: "test_entity",
            entityId,
            action: "test.created",
            after: { name: "should not survive" },
          });
          throw new Error("deliberate rollback");
        }),
      ).rejects.toThrow("deliberate rollback");

      const rows = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)),
      );
      expect(rows).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a committed audit write survives and carries request context",
    async () => {
      const { tenant, companyId } = await seedCompany("audit-commit");
      const entityId = randomUUID();

      await withTenantSchema(tenant.schemaName, async (tx) => {
        await insertAuditLog(tx, {
          companyId,
          entity: "test_entity",
          entityId,
          action: "test.created",
          after: { name: "Acme" },
        });
      });

      const [row] = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)),
      );
      expect(row).toMatchObject({
        companyId,
        entity: "test_entity",
        entityId,
        action: "test.created",
        after: { name: "Acme" },
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the application role cannot UPDATE an audit_logs row",
    async () => {
      const { tenant, companyId } = await seedCompany("audit-immutable-update");
      const entityId = randomUUID();

      await withTenantSchema(tenant.schemaName, (tx) =>
        insertAuditLog(tx, { companyId, entity: "test_entity", entityId, action: "test.created" }),
      );

      await expectPermissionDenied(
        withTenantSchema(tenant.schemaName, (tx) =>
          tx.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.entityId, entityId)),
        ),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the application role cannot DELETE an audit_logs row",
    async () => {
      const { tenant, companyId } = await seedCompany("audit-immutable-delete");
      const entityId = randomUUID();

      await withTenantSchema(tenant.schemaName, (tx) =>
        insertAuditLog(tx, { companyId, entity: "test_entity", entityId, action: "test.created" }),
      );

      await expectPermissionDenied(
        withTenantSchema(tenant.schemaName, (tx) =>
          tx.delete(auditLogs).where(eq(auditLogs.entityId, entityId)),
        ),
      );

      const rows = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)),
      );
      expect(rows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the application role CAN still INSERT and SELECT audit_logs",
    async () => {
      const { tenant, companyId } = await seedCompany("audit-can-insert-select");
      const entityId = randomUUID();

      await expect(
        withTenantSchema(tenant.schemaName, (tx) =>
          insertAuditLog(tx, { companyId, entity: "test_entity", entityId, action: "test.created" }),
        ),
      ).resolves.toBeUndefined();

      const rows = await withTenantSchema(tenant.schemaName, (tx) =>
        tx.select().from(auditLogs).where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.companyId, companyId))),
      );
      expect(rows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
