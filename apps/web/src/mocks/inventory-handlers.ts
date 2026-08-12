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
 * Prompt 22, mock world: one movement per item, but only for a purchase
 * with at least one APPROVED invoice - a purchase's own status (even
 * "posted") never moves stock by itself anymore. This mock simplifies
 * the real reverse-then-reissue reconciliation (Part 4) to "current items
 * of every purchase with an approved invoice" - good enough to prove the
 * UI wiring (approving an invoice makes stock appear); it does not
 * replicate the real backend's exact reconciliation trail.
 */
function computeMovements(): MockMovement[] {
  const movements: MockMovement[] = [];
  for (const purchase of purchases) {
    const hasApprovedInvoice = purchase.invoices.some((invoice) => invoice.status === "approved");
    if (!hasApprovedInvoice) {
      continue;
    }
    const warehouseId = typeof purchase.shipment.warehouseId === "string" ? purchase.shipment.warehouseId : "";
    const branchId = typeof purchase.branchId === "string" ? purchase.branchId : null;
    for (const item of purchase.items) {
      const itemId = typeof item.itemId === "string" ? item.itemId : "";
      const gradeId = typeof item.gradeId === "string" ? item.gradeId : null;
      const quantity = typeof item.quantity === "string" ? item.quantity : "0";
      const uomId = typeof item.uomId === "string" ? item.uomId : "";
      movements.push({
        id: `movement-${String(item.id)}`,
        itemId,
        gradeId,
        warehouseId,
        quantity,
        uomId,
        branchId,
        movementType: "purchase_receipt",
        movementDate: typeof purchase.purchaseDate === "string" ? purchase.purchaseDate : "",
        referenceType: "purchase_item",
        referenceId: String(item.id),
        sourcePurchaseId: purchase.id,
        sourcePurchaseNumber: purchase.purchaseNumber,
      });
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
