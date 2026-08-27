import { http, HttpResponse } from "msw";
import { paginatedRowsResponseSchema } from "@ikration/contracts";
import { endpoints } from "../core/api/endpoints";
import { purchases } from "./purchase-handlers";

const API_BASE = import.meta.env.VITE_WEB_API_BASE_URL;

interface MockMovement {
  id: string;
  itemId: string;
  gradeId: string | null;
  warehouseId: string;
  quantity: string;
  uomId: string;
  branchId: string | null;
  movementType: "purchase_receipt";
  movementDate: string;
  referenceType: "purchase_item";
  referenceId: string;
  sourcePurchaseId: string;
  sourcePurchaseNumber: string;
}

/**
 * PL-1, mock world: one movement per CONFIRMED receipt line - a purchase's
 * own status, and a bill's approval, never move stock by themselves
 * anymore (that's the whole point of the four-document rework: only the
 * Receipt moves stock). Mirrors the real backend's receipt.confirmed
 * subscriber - each confirmed receipt's own lines become movements,
 * keyed by their own purchaseItemId, resolved back to the item/grade/uom
 * the parent purchase's item carries.
 */
function computeMovements(): MockMovement[] {
  const movements: MockMovement[] = [];
  for (const purchase of purchases) {
    const warehouseIdFallback = typeof purchase.shipment.warehouseId === "string" ? purchase.shipment.warehouseId : "";
    const branchId = typeof purchase.branchId === "string" ? purchase.branchId : null;
    const itemsById = new Map(purchase.items.map((item) => [String(item.id), item]));

    for (const receipt of purchase.receipts) {
      if (receipt.status !== "confirmed") {
        continue;
      }
      const receiptWarehouseId = typeof receipt.warehouseId === "string" ? receipt.warehouseId : warehouseIdFallback;
      const lines = Array.isArray(receipt.items) ? (receipt.items as Record<string, unknown>[]) : [];
      for (const line of lines) {
        const purchaseItemId = typeof line.purchaseItemId === "string" ? line.purchaseItemId : "";
        const item = itemsById.get(purchaseItemId);
        if (!item) {
          continue;
        }
        const itemId = typeof item.itemId === "string" ? item.itemId : "";
        const gradeId = typeof item.gradeId === "string" ? item.gradeId : null;
        const quantity = typeof line.receivedQuantity === "string" ? line.receivedQuantity : "0";
        const uomId = typeof item.uomId === "string" ? item.uomId : "";
        const lineId = typeof line.id === "string" || typeof line.id === "number" ? String(line.id) : purchaseItemId;
        movements.push({
          id: `movement-${lineId}`,
          itemId,
          gradeId,
          warehouseId: receiptWarehouseId,
          quantity,
          uomId,
          branchId,
          movementType: "purchase_receipt",
          movementDate: typeof receipt.receiptDate === "string" ? receipt.receiptDate : "",
          referenceType: "purchase_item",
          referenceId: purchaseItemId,
          sourcePurchaseId: purchase.id,
          sourcePurchaseNumber: purchase.purchaseNumber,
        });
      }
    }
  }
  return movements.reverse();
}

function paginate<T>(rows: T[], page: number, pageSize: number): { items: T[]; total: number } {
  return { items: rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize), total: rows.length };
}

export const inventoryHandlers = [
  http.get(`${API_BASE}${endpoints.inventoryBalances}`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const itemId = url.searchParams.get("itemId");
    const warehouseId = url.searchParams.get("warehouseId");
    const branchId = url.searchParams.get("branchId");

    let movements = computeMovements();
    if (itemId) movements = movements.filter((m) => m.itemId === itemId);
    if (warehouseId) movements = movements.filter((m) => m.warehouseId === warehouseId);
    if (branchId) movements = movements.filter((m) => m.branchId === branchId);

    const grouped = new Map<string, { itemId: string; gradeId: string | null; warehouseId: string; uomId: string; quantity: number }>();
    for (const movement of movements) {
      const key = `${movement.itemId}::${movement.gradeId ?? ""}::${movement.warehouseId}::${movement.uomId}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += Number(movement.quantity);
      } else {
        grouped.set(key, { itemId: movement.itemId, gradeId: movement.gradeId, warehouseId: movement.warehouseId, uomId: movement.uomId, quantity: Number(movement.quantity) });
      }
    }
    const balanceRows = [...grouped.values()].map((row) => ({ ...row, quantity: row.quantity.toFixed(6) }));

    const { items, total } = paginate(balanceRows, page, pageSize);
    return HttpResponse.json(paginatedRowsResponseSchema.parse({ items, total, page, pageSize }));
  }),

  http.get(`${API_BASE}${endpoints.inventoryMovements}`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const itemId = url.searchParams.get("itemId");
    const warehouseId = url.searchParams.get("warehouseId");
    const branchId = url.searchParams.get("branchId");
    const gradeId = url.searchParams.get("gradeId");
    const movementType = url.searchParams.get("movementType");
    const movementDateFrom = url.searchParams.get("movementDateFrom");
    const movementDateTo = url.searchParams.get("movementDateTo");

    let movements = computeMovements();
    if (itemId) movements = movements.filter((m) => m.itemId === itemId);
    if (warehouseId) movements = movements.filter((m) => m.warehouseId === warehouseId);
    if (branchId) movements = movements.filter((m) => m.branchId === branchId);
    if (gradeId) movements = movements.filter((m) => m.gradeId === gradeId);
    if (movementType) movements = movements.filter((m) => m.movementType === movementType);
    if (movementDateFrom) movements = movements.filter((m) => m.movementDate >= movementDateFrom);
    if (movementDateTo) movements = movements.filter((m) => m.movementDate <= movementDateTo);

    const { items, total } = paginate(movements, page, pageSize);
    return HttpResponse.json(paginatedRowsResponseSchema.parse({ items, total, page, pageSize }));
  }),

  http.get(`${API_BASE}${endpoints.inventoryMovementsForBalance(":itemId", ":warehouseId")}`, ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const itemId = typeof params.itemId === "string" ? params.itemId : "";
    const warehouseId = typeof params.warehouseId === "string" ? params.warehouseId : "";

    const movements = computeMovements().filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
    const { items, total } = paginate(movements, page, pageSize);
    return HttpResponse.json(paginatedRowsResponseSchema.parse({ items, total, page, pageSize }));
  }),
];
