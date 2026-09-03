import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { contracts } from "../../database/tenant/schema.js";

export type ContractRow = typeof contracts.$inferSelect;
export type ContractInsert = typeof contracts.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

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
