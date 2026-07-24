import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { branches } from "../../database/tenant/schema.js";
import type { PaginatedRows } from "../../core/masters/types.js";

export type BranchRow = typeof branches.$inferSelect;
export type BranchInsert = typeof branches.$inferInsert;

export interface BranchesListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
}

function scopeConditions(companyId: string) {
  return [eq(branches.companyId, companyId), isNull(branches.deletedAt)];
}

export async function listBranches(
  tx: TenantTx,
  companyId: string,
  params: BranchesListParams,
): Promise<PaginatedRows<BranchRow>> {
  const conditions = scopeConditions(companyId);
  if (params.search) {
    conditions.push(ilike(branches.name, `%${params.search}%`));
  }
  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select()
      .from(branches)
      .where(where)
      .orderBy(asc(branches.name))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(branches).where(where),
  ]);

  return {
    items: rows,
    total: totalRows[0]?.value ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** Active-only, unpaginated, sorted for display - powers a dropdown (GET /api/v1/branches/options), e.g. Purchase's own branchId field. Same convention as core/masters/repository.ts's listOptions. */
export async function listActiveBranches(tx: TenantTx, companyId: string): Promise<BranchRow[]> {
  return tx
    .select()
    .from(branches)
    .where(and(eq(branches.status, "active"), ...scopeConditions(companyId)))
    .orderBy(asc(branches.name));
}

export async function findBranchById(tx: TenantTx, companyId: string, id: string): Promise<BranchRow | undefined> {
  const [row] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), ...scopeConditions(companyId)))
    .limit(1);
  return row;
}

export async function findBranchByCode(tx: TenantTx, companyId: string, code: string): Promise<BranchRow | undefined> {
  const [row] = await tx
    .select()
    .from(branches)
    .where(and(eq(branches.code, code), ...scopeConditions(companyId)))
    .limit(1);
  return row;
}

export async function insertBranch(tx: TenantTx, values: BranchInsert): Promise<BranchRow> {
  const [row] = await tx.insert(branches).values(values).returning();
  if (!row) {
    throw new Error("failed to insert branch");
  }
  return row;
}

export async function updateBranch(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<BranchRow | undefined> {
  const [row] = await tx
    .update(branches)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(branches.id, id), ...scopeConditions(companyId)))
    .returning();
  return row;
}
