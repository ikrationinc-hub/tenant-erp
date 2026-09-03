import { eq } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { customers, suppliers } from "../../database/tenant/schema.js";
import type { PlaceholderContext } from "./placeholder-resolver.js";
import type { ContractPartyRow } from "./contract-parties.repository.js";
import type { ContractRow } from "./contracts.repository.js";

/**
 * C-3b: builds the PlaceholderContext (placeholder-resolver.ts) for a
 * given contract - the token namespace C-2's build-context.ts proposed
 * (seller.*, buyer.*, commercial.*, shipment.*, payment.*), sourced from
 * this contract's OWN already-snapshotted/stored fields, never a live
 * re-read of the linked purchase (contracts.service.ts's create() already
 * copied whatever prefill applied into this contract's own columns at
 * create time). commercial.rate is the only MONEY_TOKEN - matches C-2's
 * own convention exactly.
 */
export const CONTRACT_MONEY_TOKENS = ["commercial.rate"] as const;

async function resolvePartyName(tx: TenantTx, party: ContractPartyRow | undefined): Promise<{ name: string; address: string } | undefined> {
  if (!party) {
    return undefined;
  }
  if (party.supplierId) {
    const [supplier] = await tx.select({ name: suppliers.name, address: suppliers.address }).from(suppliers).where(eq(suppliers.id, party.supplierId)).limit(1);
    return supplier ? { name: supplier.name, address: supplier.address ?? "" } : undefined;
  }
  if (party.customerId) {
    const [customer] = await tx.select({ name: customers.name }).from(customers).where(eq(customers.id, party.customerId)).limit(1);
    return customer ? { name: customer.name, address: "" } : undefined;
  }
  return undefined;
}

/**
 * `null`, never an empty string, for any field this contract genuinely has
 * no value for (a party never set, a shipment field this table doesn't
 * carry yet) - placeholder-resolver.ts's stringifyValue throws
 * MissingPlaceholderError on `null`, exactly the "explicit error, never a
 * silent blank" rule C-2 established. An empty string would instead
 * resolve "successfully" to nothing, which is the exact failure mode the
 * spec calls a legal problem - shipment.port/shipment.eta have no source
 * column on `contracts` at all yet, so a template referencing them must
 * fail loudly, not silently render blank.
 */
export async function buildContractPlaceholderContext(
  tx: TenantTx,
  contract: ContractRow,
  parties: ContractPartyRow[],
): Promise<PlaceholderContext> {
  const seller = await resolvePartyName(tx, parties.find((p) => p.partyRole === "seller"));
  const buyer = await resolvePartyName(tx, parties.find((p) => p.partyRole === "buyer"));

  return {
    seller: { name: seller?.name ?? null, address: seller?.address ?? null },
    buyer: { name: buyer?.name ?? null, address: buyer?.address ?? null },
    commercial: {
      rate: contract.rateUsd ?? null,
      currency: contract.rateUsd ? "USD" : null,
      quantity: contract.weightKg ?? null,
    },
    shipment: { port: null, eta: null },
    payment: { terms: contract.deliveryTerms ?? null, dueDate: null },
  };
}
