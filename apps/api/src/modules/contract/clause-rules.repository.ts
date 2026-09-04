import { and, eq, isNull, or } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { clauseRules } from "../../database/tenant/schema.js";

export type ClauseRuleRow = typeof clauseRules.$inferSelect;
export type ClauseRuleInsert = typeof clauseRules.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listClauseRules(tx: TenantTx, companyId: string): Promise<ClauseRuleRow[]> {
  return tx.select().from(clauseRules).where(and(eq(clauseRules.companyId, companyId), isNull(clauseRules.deletedAt)));
}

/** Every ACTIVE rule that applies to this contract's division - all-divisions rows (divisionId NULL) OR rows scoped to this exact division, same OR-null convention as field_definitions/clauses/contract_templates. */
export async function listActiveClauseRulesForDivision(tx: TenantTx, companyId: string, divisionId: string | null): Promise<ClauseRuleRow[]> {
  const divisionCondition = divisionId ? or(isNull(clauseRules.divisionId), eq(clauseRules.divisionId, divisionId)) : isNull(clauseRules.divisionId);
  return tx
    .select()
    .from(clauseRules)
    .where(and(eq(clauseRules.companyId, companyId), eq(clauseRules.isActive, true), isNull(clauseRules.deletedAt), divisionCondition));
}

export async function findClauseRuleById(tx: TenantTx, companyId: string, id: string): Promise<ClauseRuleRow | undefined> {
  const [row] = await tx
    .select()
    .from(clauseRules)
    .where(and(eq(clauseRules.id, id), eq(clauseRules.companyId, companyId), isNull(clauseRules.deletedAt)))
    .limit(1);
  return row;
}

export async function insertClauseRule(tx: TenantTx, values: ClauseRuleInsert): Promise<ClauseRuleRow> {
  const [row] = await tx.insert(clauseRules).values(values).returning();
  if (!row) {
    throw new Error("failed to insert clause rule");
  }
  return row;
}

export async function updateClauseRuleFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<ClauseRuleInsert>,
): Promise<ClauseRuleRow | undefined> {
  const [row] = await tx
    .update(clauseRules)
    .set(values)
    .where(and(eq(clauseRules.id, id), eq(clauseRules.companyId, companyId), isNull(clauseRules.deletedAt)))
    .returning();
  return row;
}
