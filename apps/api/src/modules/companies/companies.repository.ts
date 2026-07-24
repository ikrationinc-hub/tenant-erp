import { and, asc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { companies } from "../../database/tenant/schema.js";
import type { PaginatedRows } from "../../core/masters/types.js";

export type CompanyRow = typeof companies.$inferSelect;
export type CompanyInsert = typeof companies.$inferInsert;

export interface CompaniesListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
}

/**
 * Not built on core/masters (task item 1's own instruction to consider,
 * then reject, the generic pattern): companies have no company_id/branch_id
 * scope of their own - they ARE the scope every master and business table
 * is filtered by (CLAUDE.md's three-level scope) - so
 * core/masters/repository.ts's `scopeConditions(companyId, ...)` premise
 * doesn't apply here at all. Scoping is the tenant schema switch itself
 * (get-db.ts's THE tenant boundary) - nothing company-scoped to filter on
 * beyond that.
 */
export async function listCompanies(tx: TenantTx, params: CompaniesListParams): Promise<PaginatedRows<CompanyRow>> {
  const conditions = [isNull(companies.deletedAt)];
  if (params.search) {
    const searchCondition = ilike(companies.name, `%${params.search}%`);
    conditions.push(searchCondition);
  }
  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select()
      .from(companies)
      .where(where)
      .orderBy(asc(companies.name))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(companies).where(where),
  ]);

  return {
    items: rows,
    total: totalRows[0]?.value ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function findCompanyById(tx: TenantTx, id: string): Promise<CompanyRow | undefined> {
  const [row] = await tx
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
    .limit(1);
  return row;
}

export async function insertCompany(tx: TenantTx, values: CompanyInsert): Promise<CompanyRow> {
  const [row] = await tx.insert(companies).values(values).returning();
  if (!row) {
    throw new Error("failed to insert company");
  }
  return row;
}

export async function updateCompany(
  tx: TenantTx,
  id: string,
  values: Record<string, unknown>,
): Promise<CompanyRow | undefined> {
  const [row] = await tx
    .update(companies)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
    .returning();
  return row;
}
