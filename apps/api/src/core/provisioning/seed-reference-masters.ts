import { withTenantSchema } from "../../database/get-db.js";
import { referenceMasters } from "../../database/tenant/schema.js";

export interface SeedReferenceMastersInput {
  schemaName: string;
}

interface ReferenceMasterSeed {
  type: "country" | "currency" | "uom" | "incoterm";
  code: string;
  name: string;
}

function entries(
  type: ReferenceMasterSeed["type"],
  pairs: [code: string, name: string][],
): ReferenceMasterSeed[] {
  return pairs.map(([code, name]) => ({ type, code, name }));
}

/**
 * A representative starting set, not an exhaustive ISO/UN list - this is
 * prototype seed data a tenant extends via the (not-yet-built) generic
 * master pattern, not a claim of completeness. Incoterms is the one list
 * that IS complete: Incoterms 2020 defines exactly these 11 terms.
 */
const REFERENCE_MASTER_SEEDS: ReferenceMasterSeed[] = [
  ...entries("country", [
    ["US", "United States"],
    ["GB", "United Kingdom"],
    ["AE", "United Arab Emirates"],
    ["IN", "India"],
    ["CN", "China"],
    ["SG", "Singapore"],
    ["DE", "Germany"],
    ["JP", "Japan"],
    ["AU", "Australia"],
    ["BR", "Brazil"],
  ]),
  ...entries("currency", [
    ["USD", "US Dollar"],
    ["EUR", "Euro"],
    ["GBP", "British Pound"],
    ["AED", "UAE Dirham"],
    ["INR", "Indian Rupee"],
    ["CNY", "Chinese Yuan"],
    ["JPY", "Japanese Yen"],
  ]),
  ...entries("uom", [
    ["MT", "Metric Ton"],
    ["KG", "Kilogram"],
    ["LB", "Pound"],
    ["PC", "Piece"],
    ["CBM", "Cubic Meter"],
  ]),
  ...entries("incoterm", [
    ["EXW", "Ex Works"],
    ["FCA", "Free Carrier"],
    ["CPT", "Carriage Paid To"],
    ["CIP", "Carriage and Insurance Paid To"],
    ["DAP", "Delivered at Place"],
    ["DPU", "Delivered at Place Unloaded"],
    ["DDP", "Delivered Duty Paid"],
    ["FAS", "Free Alongside Ship"],
    ["FOB", "Free on Board"],
    ["CFR", "Cost and Freight"],
    ["CIF", "Cost, Insurance and Freight"],
  ]),
];

/** Idempotent: onConflictDoUpdate against reference_masters' (type, code) unique index - not partial, no targetWhere needed. Tenant-wide (no company_id), so this runs once per tenant regardless of how many companies it has. */
export async function seedReferenceMasters(input: SeedReferenceMastersInput): Promise<void> {
  await withTenantSchema(input.schemaName, async (tx) => {
    for (const [index, seed] of REFERENCE_MASTER_SEEDS.entries()) {
      // Sequential, not batched: small fixed-size seed list (~30 rows), run once per tenant
      await tx
        .insert(referenceMasters)
        .values({ type: seed.type, code: seed.code, name: seed.name, sortOrder: index })
        .onConflictDoUpdate({
          target: [referenceMasters.type, referenceMasters.code],
          set: { name: seed.name, sortOrder: index },
        });
    }
  });
}
