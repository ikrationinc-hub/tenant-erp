import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { contractParties } from "../../database/tenant/schema.js";

export type ContractPartyRow = typeof contractParties.$inferSelect;
export type ContractPartyInsert = typeof contractParties.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function listContractParties(tx: TenantTx, companyId: string, contractId: string): Promise<ContractPartyRow[]> {
  return tx
    .select()
    .from(contractParties)
    .where(and(eq(contractParties.contractId, contractId), eq(contractParties.companyId, companyId), isNull(contractParties.deletedAt)));
}

export async function upsertContractParty(
  tx: TenantTx,
  values: ContractPartyInsert,
): Promise<ContractPartyRow> {
  const [row] = await tx
    .insert(contractParties)
    .values(values)
    .onConflictDoUpdate({
      target: [contractParties.contractId, contractParties.partyRole],
      targetWhere: isNull(contractParties.deletedAt),
      set: {
        supplierId: values.supplierId ?? null,
        customerId: values.customerId ?? null,
        updatedBy: values.createdBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) {
    throw new Error("failed to upsert contract party");
  }
  return row;
}
