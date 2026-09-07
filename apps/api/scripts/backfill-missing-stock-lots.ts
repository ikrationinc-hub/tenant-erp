import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import {
  purchaseAdditionalCosts,
  purchaseItems,
  purchasePricing,
  purchaseReceiptItems,
  purchaseReceipts,
  stockLots,
} from "../src/database/tenant/schema.js";
import { parseMoney } from "../src/common/money/decimal.js";
import { costAllocation, landedRatePerUnit } from "../src/core/inventory-lots/cost-allocation.js";
import { insertStockLot } from "../src/core/inventory-lots/stock-lots.repository.js";

/**
 * One-off: inventory-subscriber.ts's handleReceiptConfirmed only started
 * inserting a stock_lots row alongside its own stock_movements row once
 * S-2 (docs/SALES-MODULE-PLAN.md) shipped. Any purchase receipt confirmed
 * BEFORE that change exists as a real stock_movements row (so Inventory's
 * own live GROUP BY correctly shows stock on hand) but has NO stock_lots
 * row at all - meaning core/inventory-lots' entire reservation engine
 * (and every Sales Order lot-pick screen) has nothing to lock against for
 * that stock, even though it's physically on hand. Discovered via manual
 * testing: an Item 1 / Item Grade 1 lot visible on the Inventory screen
 * that never appeared in a Sales Order's "Select a lot..." dropdown.
 *
 * This recomputes and inserts the missing stock_lots row for every
 * CONFIRMED purchase_receipt_items row with no matching stock_lots row
 * (matched by receiptId + purchaseItemId, the same pair inventory-
 * subscriber.ts's own insert uses), grouped by receipt so costAllocation
 * spreads each receipt's own purchase_additional_costs pro-rata across
 * just that receipt's own lines - the exact computation purchase-
 * receipts.service.ts's confirm() already does at real confirm time,
 * replayed here for receipts that predate the stock_lots write.
 */
async function backfillTenant(schemaName: string): Promise<{ inserted: number; receiptsTouched: number }> {
  return withTenantSchema(schemaName, async (tx) => {
    const confirmedReceipts = await tx.select().from(purchaseReceipts).where(and(eq(purchaseReceipts.status, "confirmed"), isNull(purchaseReceipts.deletedAt)));

    let inserted = 0;
    let receiptsTouched = 0;

    for (const receipt of confirmedReceipts) {
      const items = await tx
        .select()
        .from(purchaseReceiptItems)
        .where(and(eq(purchaseReceiptItems.receiptId, receipt.id), eq(purchaseReceiptItems.companyId, receipt.companyId)));
      if (items.length === 0) continue;

      const existingLots = await tx
        .select({ purchaseItemId: stockLots.purchaseItemId })
        .from(stockLots)
        .where(
          and(
            eq(stockLots.receiptId, receipt.id),
            eq(stockLots.companyId, receipt.companyId),
            inArray(
              stockLots.purchaseItemId,
              items.map((item) => item.purchaseItemId),
            ),
          ),
        );
      const alreadyPresentPurchaseItemIds = new Set(existingLots.map((row) => row.purchaseItemId));
      const missingItems = items.filter((item) => !alreadyPresentPurchaseItemIds.has(item.purchaseItemId));
      if (missingItems.length === 0) continue;

      const purchaseItemRows = await tx
        .select({ item: purchaseItems, pricing: purchasePricing })
        .from(purchaseItems)
        .innerJoin(purchasePricing, eq(purchasePricing.purchaseItemId, purchaseItems.id))
        .where(
          and(
            eq(purchaseItems.purchaseId, receipt.purchaseId),
            inArray(
              purchaseItems.id,
              missingItems.map((item) => item.purchaseItemId),
            ),
            notInArray(purchaseItems.id, []),
          ),
        );
      const purchaseItemById = new Map(purchaseItemRows.map((row) => [row.item.id, row]));

      const [costs] = await tx.select().from(purchaseAdditionalCosts).where(eq(purchaseAdditionalCosts.purchaseId, receipt.purchaseId));
      const sharedCharges = {
        freight: costs?.freight ?? "0",
        insurance: costs?.insurance ?? "0",
        customs: costs?.customs ?? "0",
        other: parseMoney(costs?.otherCharges ?? "0")
          .plus(costs?.otherCharges2 ?? "0")
          .plus(costs?.otherCharges3 ?? "0")
          .toString(),
      };

      const allocationLines = missingItems
        .map((item) => {
          const purchaseItem = purchaseItemById.get(item.purchaseItemId);
          if (!purchaseItem) return undefined;
          return { lotId: item.id, qty: item.receivedQuantity, landedRate: purchaseItem.pricing.purchaseRateUsd };
        })
        .filter((line): line is { lotId: string; qty: string; landedRate: string } => line !== undefined);
      if (allocationLines.length === 0) continue;

      const allocatedCosts = costAllocation(allocationLines, sharedCharges, "qty");
      const landedRateByReceiptItemId = new Map(
        allocatedCosts.map((allocation) => [
          allocation.lotId,
          landedRatePerUnit(allocation.cost, allocationLines.find((l) => l.lotId === allocation.lotId)?.qty ?? "0"),
        ]),
      );

      let touchedThisReceipt = false;
      for (const item of missingItems) {
        const purchaseItem = purchaseItemById.get(item.purchaseItemId);
        if (!purchaseItem) continue;
        const landedRate = landedRateByReceiptItemId.get(item.id);
        if (!landedRate) continue;

        const lot = await insertStockLot(tx, {
          companyId: receipt.companyId,
          ...(receipt.branchId ? { branchId: receipt.branchId } : {}),
          itemId: purchaseItem.item.itemId,
          ...(purchaseItem.item.gradeId ? { gradeId: purchaseItem.item.gradeId } : {}),
          warehouseId: receipt.warehouseId,
          receiptId: receipt.id,
          purchaseItemId: item.purchaseItemId,
          uomId: purchaseItem.item.uomId,
          receivedQty: item.receivedQuantity,
          landedRate,
          reservedQty: "0",
          deliveredQty: "0",
          createdBy: receipt.receivedBy,
        });
        inserted += 1;
        touchedThisReceipt = true;
        logger.info(
          { schemaName, receiptNumber: receipt.receiptNumber, purchaseItemId: item.purchaseItemId, lotId: lot.id, receivedQty: lot.receivedQty },
          "backfilled missing stock lot",
        );
      }
      if (touchedThisReceipt) receiptsTouched += 1;
    }

    return { inserted, receiptsTouched };
  });
}

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
  let totalInserted = 0;
  for (const tenant of activeTenants) {
    const { inserted, receiptsTouched } = await backfillTenant(tenant.schemaName);
    totalInserted += inserted;
    console.log(`  ${tenant.slug} (${tenant.schemaName}): ${inserted} lot(s) backfilled across ${receiptsTouched} receipt(s)`);
  }
  console.log(`\nOK: ${activeTenants.length} tenant(s) processed - ${totalInserted} stock_lots row(s) backfilled\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "missing stock lots backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
