import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { deliveries, deliveryItems, salesItemLots, salesItems, sales, stockLotReservations } from "../../database/tenant/schema.js";

export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryInsert = typeof deliveries.$inferInsert;
export type DeliveryItemRow = typeof deliveryItems.$inferSelect;
export type DeliveryItemInsert = typeof deliveryItems.$inferInsert;

/** The cross-sale Deliveries list's own row shape - the delivery's own columns plus its parent sale's number, mirroring purchase-receipts.repository.ts's PurchaseReceiptWithPurchaseNumber. */
export interface DeliveryWithSalesNumber extends DeliveryRow {
  salesNumber: string;
}

export interface DeliveriesListParams {
  page: number;
  pageSize: number;
  status?: DeliveryRow["status"] | undefined;
  warehouseId?: string | undefined;
  dispatchDateFrom?: string | undefined;
  dispatchDateTo?: string | undefined;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Mirrors purchase-receipts.repository.ts. */

export async function listAllDeliveries(tx: TenantTx, companyId: string, params: DeliveriesListParams): Promise<PaginatedRows<DeliveryWithSalesNumber>> {
  const conditions = [eq(deliveries.companyId, companyId), isNull(deliveries.deletedAt)];
  if (params.status) {
    conditions.push(eq(deliveries.status, params.status));
  }
  if (params.warehouseId) {
    conditions.push(eq(deliveries.warehouseId, params.warehouseId));
  }
  if (params.dispatchDateFrom) {
    conditions.push(gte(deliveries.dispatchDate, params.dispatchDateFrom));
  }
  if (params.dispatchDateTo) {
    conditions.push(lte(deliveries.dispatchDate, params.dispatchDateTo));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select({
        id: deliveries.id,
        companyId: deliveries.companyId,
        branchId: deliveries.branchId,
        salesId: deliveries.salesId,
        deliveryOrderNo: deliveries.deliveryOrderNo,
        dispatchDate: deliveries.dispatchDate,
        vehicleNumber: deliveries.vehicleNumber,
        transportCompany: deliveries.transportCompany,
        driverName: deliveries.driverName,
        gatePassNo: deliveries.gatePassNo,
        podReceived: deliveries.podReceived,
        customerAcknowledgement: deliveries.customerAcknowledgement,
        warehouseId: deliveries.warehouseId,
        status: deliveries.status,
        confirmedBy: deliveries.confirmedBy,
        confirmedAt: deliveries.confirmedAt,
        createdAt: deliveries.createdAt,
        updatedAt: deliveries.updatedAt,
        createdBy: deliveries.createdBy,
        updatedBy: deliveries.updatedBy,
        deletedAt: deliveries.deletedAt,
        version: deliveries.version,
        salesNumber: sales.salesNumber,
      })
      .from(deliveries)
      .innerJoin(sales, eq(sales.id, deliveries.salesId))
      .where(where)
      .orderBy(desc(deliveries.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(deliveries).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function listDeliveriesForSales(tx: TenantTx, companyId: string, salesId: string): Promise<DeliveryRow[]> {
  return tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.salesId, salesId), eq(deliveries.companyId, companyId), isNull(deliveries.deletedAt)))
    .orderBy(asc(deliveries.createdAt));
}

export async function findDeliveryById(tx: TenantTx, companyId: string, salesId: string, id: string): Promise<DeliveryRow | undefined> {
  const [row] = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, id), eq(deliveries.salesId, salesId), eq(deliveries.companyId, companyId), isNull(deliveries.deletedAt)))
    .limit(1);
  return row;
}

export async function listItemsForDelivery(tx: TenantTx, companyId: string, deliveryId: string): Promise<DeliveryItemRow[]> {
  return tx
    .select()
    .from(deliveryItems)
    .where(and(eq(deliveryItems.deliveryId, deliveryId), eq(deliveryItems.companyId, companyId)))
    .orderBy(asc(deliveryItems.createdAt));
}

export async function insertDelivery(tx: TenantTx, values: DeliveryInsert): Promise<DeliveryRow> {
  const [row] = await tx.insert(deliveries).values(values).returning();
  if (!row) {
    throw new Error("failed to insert delivery");
  }
  return row;
}

export async function insertDeliveryItem(tx: TenantTx, values: DeliveryItemInsert): Promise<DeliveryItemRow> {
  const [row] = await tx.insert(deliveryItems).values(values).returning();
  if (!row) {
    throw new Error("failed to insert delivery item");
  }
  return row;
}

/** CAS transition, same shape as purchase-receipts.repository.ts's transitionReceiptStatus - a concurrent double-confirm loses the race cleanly (zero rows matched) rather than double-consuming a reservation. */
export async function transitionDeliveryStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: DeliveryRow["status"]; to: DeliveryRow["status"]; extra?: Record<string, unknown> },
): Promise<DeliveryRow | undefined> {
  const [row] = await tx
    .update(deliveries)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(and(eq(deliveries.id, id), eq(deliveries.companyId, companyId), eq(deliveries.status, input.from), isNull(deliveries.deletedAt)))
    .returning();
  return row;
}

/**
 * One row per (sales item, reservation) - the join deliveries.service.ts
 * needs to both (a) know how much of a sales item's reservation is already
 * consumed and (b) actually call consumeReservation against the specific
 * reservation row(s) backing it. A sales item can have MULTIPLE
 * reservations (multiple lots picked for one line) - callers consume
 * across them in order until the requested delivered qty is exhausted.
 * Excludes released reservations (nothing left to consume there).
 */
export interface SalesItemReservation {
  reservationId: string;
  qty: string;
  consumedQty: string;
}

export async function listActiveReservationsForSalesItem(tx: TenantTx, companyId: string, salesItemId: string): Promise<SalesItemReservation[]> {
  const rows = await tx
    .select({
      reservationId: stockLotReservations.id,
      qty: stockLotReservations.qty,
      consumedQty: stockLotReservations.consumedQty,
    })
    .from(salesItemLots)
    .innerJoin(stockLotReservations, eq(stockLotReservations.id, salesItemLots.reservationId))
    .where(
      and(
        eq(salesItemLots.salesItemId, salesItemId),
        eq(salesItemLots.companyId, companyId),
        isNull(salesItemLots.deletedAt),
        isNull(stockLotReservations.releasedAt),
      ),
    )
    .orderBy(asc(stockLotReservations.createdAt));
  return rows;
}

export interface ReservedAndConsumedRow {
  salesItemId: string;
  reservedQty: string;
  consumedQty: string;
}

/**
 * SUM(stock_lot_reservations.qty) and SUM(consumedQty), per sales item,
 * across every ACTIVE (non-released) reservation for the given sale - the
 * over-delivery guard (deliveries.service.ts's create()) and
 * sales.service.ts's own deliveredStatus both read this rather than
 * re-summing delivery_items, since consumeReservation is the sole writer
 * of consumedQty and already enforces "cannot over-consume" itself.
 */
export async function sumReservedAndConsumedBySalesItem(tx: TenantTx, companyId: string, salesId: string): Promise<ReservedAndConsumedRow[]> {
  const rows = await tx
    .select({
      salesItemId: salesItemLots.salesItemId,
      reservedQty: sql<string>`sum(${stockLotReservations.qty})`.as("reserved_qty"),
      consumedQty: sql<string>`sum(${stockLotReservations.consumedQty})`.as("consumed_qty"),
    })
    .from(salesItemLots)
    .innerJoin(stockLotReservations, eq(stockLotReservations.id, salesItemLots.reservationId))
    .innerJoin(salesItems, eq(salesItems.id, salesItemLots.salesItemId))
    .where(
      and(
        eq(salesItems.salesId, salesId),
        eq(salesItemLots.companyId, companyId),
        isNull(salesItemLots.deletedAt),
        isNull(salesItems.deletedAt),
        isNull(stockLotReservations.releasedAt),
      ),
    )
    .groupBy(salesItemLots.salesItemId);
  return rows;
}

/** Batched, list-screen version of the above - one query for every sale on the current page, mirroring purchase-receipts.repository.ts's own sumConfirmedReceivedQuantitiesByItemForPurchases. */
export interface ReservedAndConsumedRowForSales extends ReservedAndConsumedRow {
  salesId: string;
}

export async function sumReservedAndConsumedBySalesItemForSalesOrders(
  tx: TenantTx,
  companyId: string,
  salesIds: string[],
): Promise<ReservedAndConsumedRowForSales[]> {
  if (salesIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      salesId: salesItems.salesId,
      salesItemId: salesItemLots.salesItemId,
      reservedQty: sql<string>`sum(${stockLotReservations.qty})`.as("reserved_qty"),
      consumedQty: sql<string>`sum(${stockLotReservations.consumedQty})`.as("consumed_qty"),
    })
    .from(salesItemLots)
    .innerJoin(stockLotReservations, eq(stockLotReservations.id, salesItemLots.reservationId))
    .innerJoin(salesItems, eq(salesItems.id, salesItemLots.salesItemId))
    .where(
      and(
        inArray(salesItems.salesId, salesIds),
        eq(salesItemLots.companyId, companyId),
        isNull(salesItemLots.deletedAt),
        isNull(salesItems.deletedAt),
        isNull(stockLotReservations.releasedAt),
      ),
    )
    .groupBy(salesItems.salesId, salesItemLots.salesItemId);
  return rows;
}

export interface DeliveredQuantityRow {
  salesItemId: string;
  deliveredQuantity: string;
}

/**
 * SUM(delivered_quantity) per sales_item, across every CONFIRMED delivery
 * for the given sale - only confirmed counts (a draft delivery hasn't
 * actually shipped anything yet, mirrors purchase-receipts.repository.ts's
 * own "only CONFIRMED receipts count" precedent, unlike sumBilledQuantities
 * ByItem's own "draft AND approved both count" rule for bills, since
 * billing itself - not shipping - is the financial fact there). This is
 * sales-invoices.service.ts's own over-invoicing ceiling: an invoice
 * should only ever bill what actually shipped (docs/adr/0028).
 */
export async function sumDeliveredQuantitiesByItem(tx: TenantTx, companyId: string, salesId: string): Promise<DeliveredQuantityRow[]> {
  const rows = await tx
    .select({
      salesItemId: deliveryItems.salesItemId,
      deliveredQuantity: sql<string>`sum(${deliveryItems.deliveredQuantity})`.as("delivered_quantity"),
    })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
    .where(and(eq(deliveries.salesId, salesId), eq(deliveries.companyId, companyId), isNull(deliveries.deletedAt), eq(deliveries.status, "confirmed")))
    .groupBy(deliveryItems.salesItemId);
  return rows;
}

export interface DeliveredQuantityRowForSales extends DeliveredQuantityRow {
  salesId: string;
}

/** Batched, list-screen version of sumDeliveredQuantitiesByItem above - one query for every sale on the current page, mirroring sumReservedAndConsumedBySalesItemForSalesOrders exactly. */
export async function sumDeliveredQuantitiesByItemForSalesOrders(
  tx: TenantTx,
  companyId: string,
  salesIds: string[],
): Promise<DeliveredQuantityRowForSales[]> {
  if (salesIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({
      salesId: deliveries.salesId,
      salesItemId: deliveryItems.salesItemId,
      deliveredQuantity: sql<string>`sum(${deliveryItems.deliveredQuantity})`.as("delivered_quantity"),
    })
    .from(deliveryItems)
    .innerJoin(deliveries, eq(deliveries.id, deliveryItems.deliveryId))
    .where(and(inArray(deliveries.salesId, salesIds), eq(deliveries.companyId, companyId), isNull(deliveries.deletedAt), eq(deliveries.status, "confirmed")))
    .groupBy(deliveries.salesId, deliveryItems.salesItemId);
  return rows;
}
