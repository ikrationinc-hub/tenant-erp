import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * Current quantity per (item, grade, warehouse) - DERIVED by summing
 * stock_movements, never a stored balance. `gradeId` is part of the
 * grouping key (not just item+warehouse) because it's a real dimension on
 * every movement row - "Copper Grade A" and "Copper Grade B" in the same
 * warehouse are different physical stock, not the same balance.
 */
export const balancesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});
export type BalancesListQuery = z.infer<typeof balancesListQuerySchema>;

/** The raw ledger - every movement, newest first, filterable. Read-only: there is no PATCH/DELETE anywhere in this module (a correction is a new, offsetting movement, never an edit - same principle as posted-document immutability, rule 8). */
export const movementsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  itemId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  movementType: z.enum(["purchase_receipt"]).optional(),
  referenceType: z.string().min(1).optional(),
  referenceId: z.string().uuid().optional(),
  movementDateFrom: dateStringSchema.optional(),
  movementDateTo: dateStringSchema.optional(),
});
export type MovementsListQuery = z.infer<typeof movementsListQuerySchema>;

/** GET /inventory/movements/:itemId/:warehouseId - the movement history behind one balance row. */
export const movementsByBalanceParamsSchema = z.object({
  itemId: z.string().uuid(),
  warehouseId: z.string().uuid(),
});
export type MovementsByBalanceParams = z.infer<typeof movementsByBalanceParamsSchema>;

export const movementsByBalanceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  gradeId: z.string().uuid().optional(),
});
export type MovementsByBalanceQuery = z.infer<typeof movementsByBalanceQuerySchema>;
