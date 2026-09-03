import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { contracts } from "../../database/tenant/schema.js";

export type ContractRow = typeof contracts.$inferSelect;
export type ContractInsert = typeof contracts.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface ContractsListParams {
  page: number;
  pageSize: number;
  status?: ContractRow["status"] | undefined;
  divisionId?: string | undefined;
}

export async function listContracts(tx: TenantTx, companyId: string, params: ContractsListParams): Promise<PaginatedRows<ContractRow>> {
  const conditions = [eq(contracts.companyId, companyId), isNull(contracts.deletedAt)];
  if (params.status) {
    conditions.push(eq(contracts.status, params.status));
  }
  if (params.divisionId) {
    conditions.push(eq(contracts.divisionId, params.divisionId));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(contracts).where(where).orderBy(desc(contracts.createdAt)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(contracts).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function insertContract(tx: TenantTx, values: ContractInsert): Promise<ContractRow> {
  const [row] = await tx.insert(contracts).values(values).returning();
  if (!row) {
    throw new Error("failed to insert contract");
  }
  return row;
}

export async function findContractById(tx: TenantTx, companyId: string, id: string): Promise<ContractRow | undefined> {
  const [row] = await tx
    .select()
    .from(contracts)
    .where(and(eq(contracts.id, id), eq(contracts.companyId, companyId), isNull(contracts.deletedAt)))
    .limit(1);
  return row;
}

export async function updateContractFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<ContractInsert>,
): Promise<ContractRow | undefined> {
  const [row] = await tx
    .update(contracts)
    .set(values)
    .where(and(eq(contracts.id, id), eq(contracts.companyId, companyId), isNull(contracts.deletedAt)))
    .returning();
  return row;
}

/** CAS transition, same shape as purchase.repository.ts's transitionPurchaseStatus - a concurrent double-transition loses the race cleanly (zero rows matched, undefined returned). */
export async function transitionContractStatus(
  tx: TenantTx,
  companyId: string,
  id: string,
  input: { from: ContractRow["status"]; to: ContractRow["status"]; extra?: Record<string, unknown> },
): Promise<ContractRow | undefined> {
  const [row] = await tx
    .update(contracts)
    .set({ status: input.to, ...(input.extra ?? {}), updatedAt: new Date() })
    .where(and(eq(contracts.id, id), eq(contracts.companyId, companyId), eq(contracts.status, input.from), isNull(contracts.deletedAt)))
    .returning();
  return row;
}
