import { and, asc, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { contractClauses } from "../../database/tenant/schema.js";

export type ContractClauseRow = typeof contractClauses.$inferSelect;
export type ContractClauseInsert = typeof contractClauses.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. THE SNAPSHOT lives here - resolvedText/clauseVersionId are written once at assembly/re-snapshot time and never mutated by any read path. */

export async function listContractClauses(tx: TenantTx, companyId: string, contractId: string): Promise<ContractClauseRow[]> {
  return tx
    .select()
    .from(contractClauses)
    .where(and(eq(contractClauses.contractId, contractId), eq(contractClauses.companyId, companyId), isNull(contractClauses.deletedAt)))
    .orderBy(asc(contractClauses.sortOrder));
}

export async function findContractClauseById(tx: TenantTx, companyId: string, contractId: string, id: string): Promise<ContractClauseRow | undefined> {
  const [row] = await tx
    .select()
    .from(contractClauses)
    .where(
      and(
        eq(contractClauses.id, id),
        eq(contractClauses.contractId, contractId),
        eq(contractClauses.companyId, companyId),
        isNull(contractClauses.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

export async function insertContractClause(tx: TenantTx, values: ContractClauseInsert): Promise<ContractClauseRow> {
  const [row] = await tx.insert(contractClauses).values(values).returning();
  if (!row) {
    throw new Error("failed to insert contract clause");
  }
  return row;
}

export async function updateContractClauseFields(
  tx: TenantTx,
  companyId: string,
  contractId: string,
  id: string,
  values: Partial<ContractClauseInsert>,
): Promise<ContractClauseRow | undefined> {
  const [row] = await tx
    .update(contractClauses)
    .set(values)
    .where(
      and(
        eq(contractClauses.id, id),
        eq(contractClauses.contractId, contractId),
        eq(contractClauses.companyId, companyId),
        isNull(contractClauses.deletedAt),
      ),
    )
    .returning();
  return row;
}

/** Soft-remove (rule 8: no hard deletes) - blocked at the service layer for a mandatory clause, this function itself has no opinion. */
export async function removeContractClause(tx: TenantTx, companyId: string, contractId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .update(contractClauses)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(contractClauses.id, id),
        eq(contractClauses.contractId, contractId),
        eq(contractClauses.companyId, companyId),
        isNull(contractClauses.deletedAt),
      ),
    )
    .returning();
  return row !== undefined;
}
