import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { clauseVersions, clauses } from "../../database/tenant/schema.js";

export type ClauseRow = typeof clauses.$inferSelect;
export type ClauseInsert = typeof clauses.$inferInsert;
export type ClauseVersionRow = typeof clauseVersions.$inferSelect;
export type ClauseVersionInsert = typeof clauseVersions.$inferInsert;

export interface ClausesListParams {
  page: number;
  pageSize: number;
  divisionId?: string | undefined;
  category?: ClauseRow["category"] | undefined;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listClauses(tx: TenantTx, companyId: string, params: ClausesListParams): Promise<PaginatedRows<ClauseRow>> {
  const conditions = [eq(clauses.companyId, companyId), isNull(clauses.deletedAt)];
  if (params.divisionId) {
    conditions.push(eq(clauses.divisionId, params.divisionId));
  }
  if (params.category) {
    conditions.push(eq(clauses.category, params.category));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select()
      .from(clauses)
      .where(where)
      .orderBy(desc(clauses.createdAt))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(clauses).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function findClauseById(tx: TenantTx, companyId: string, id: string): Promise<ClauseRow | undefined> {
  const [row] = await tx
    .select()
    .from(clauses)
    .where(and(eq(clauses.id, id), eq(clauses.companyId, companyId), isNull(clauses.deletedAt)))
    .limit(1);
  return row;
}

export async function insertClause(tx: TenantTx, values: ClauseInsert): Promise<ClauseRow> {
  const [row] = await tx.insert(clauses).values(values).returning();
  if (!row) {
    throw new Error("failed to insert clause");
  }
  return row;
}

export async function updateClauseFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<ClauseInsert>,
): Promise<ClauseRow | undefined> {
  const [row] = await tx
    .update(clauses)
    .set(values)
    .where(and(eq(clauses.id, id), eq(clauses.companyId, companyId), isNull(clauses.deletedAt)))
    .returning();
  return row;
}

export async function listVersionsForClause(tx: TenantTx, companyId: string, clauseId: string): Promise<ClauseVersionRow[]> {
  return tx
    .select()
    .from(clauseVersions)
    .where(and(eq(clauseVersions.clauseId, clauseId), eq(clauseVersions.companyId, companyId)))
    .orderBy(asc(clauseVersions.versionNumber));
}

export async function findClauseVersionById(
  tx: TenantTx,
  companyId: string,
  clauseId: string,
  id: string,
): Promise<ClauseVersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(clauseVersions)
    .where(and(eq(clauseVersions.id, id), eq(clauseVersions.clauseId, clauseId), eq(clauseVersions.companyId, companyId)))
    .limit(1);
  return row;
}

/** The clause's current Active version, if any - a brand-new clause (or one whose only version is still Draft/Approved) legitimately has none. */
export async function findActiveVersion(tx: TenantTx, companyId: string, clauseId: string): Promise<ClauseVersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(clauseVersions)
    .where(and(eq(clauseVersions.clauseId, clauseId), eq(clauseVersions.companyId, companyId), eq(clauseVersions.status, "active")))
    .limit(1);
  return row;
}

/** Highest versionNumber issued so far for this clause - callers add 1 for the next insert, inside the same transaction (row lock via findClauseById's caller pattern is not needed here: version_number's own unique index on (clause_id, version_number) makes a racing double-insert fail loudly rather than silently collide). */
export async function findMaxVersionNumber(tx: TenantTx, clauseId: string): Promise<number> {
  const [row] = await tx
    .select({ maxVersion: sql<number>`coalesce(max(${clauseVersions.versionNumber}), 0)::int` })
    .from(clauseVersions)
    .where(eq(clauseVersions.clauseId, clauseId));
  return row?.maxVersion ?? 0;
}

export async function insertClauseVersion(tx: TenantTx, values: ClauseVersionInsert): Promise<ClauseVersionRow> {
  const [row] = await tx.insert(clauseVersions).values(values).returning();
  if (!row) {
    throw new Error("failed to insert clause version");
  }
  return row;
}

export async function updateClauseVersion(
  tx: TenantTx,
  id: string,
  values: Partial<ClauseVersionInsert>,
): Promise<ClauseVersionRow | undefined> {
  const [row] = await tx.update(clauseVersions).set(values).where(eq(clauseVersions.id, id)).returning();
  return row;
}

/**
 * Every version across every tenant company whose status is 'approved' and
 * whose effectiveFrom has arrived - the scheduler's own working set (it
 * loops tenant schemas itself; within one schema this spans all companies,
 * matching how nextNumber/insertAuditLog are always company-scoped by their
 * caller, never by a WHERE the repository bakes in itself).
 */
export async function findDueApprovedVersions(tx: TenantTx, asOf: Date): Promise<ClauseVersionRow[]> {
  const asOfDateString = asOf.toISOString().slice(0, 10);
  return tx
    .select()
    .from(clauseVersions)
    .where(and(eq(clauseVersions.status, "approved"), lte(clauseVersions.effectiveFrom, asOfDateString)));
}
