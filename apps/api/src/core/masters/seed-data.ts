import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { withTenantSchema } from "../../database/get-db.js";
import { countries, currencies, incoterms, uom } from "../../database/tenant/schema.js";
import type { MasterTable } from "./types.js";

export interface SeedMasterDataInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
}

interface CodeNameSeed {
  code: string;
  name: string;
}

function pairs(list: [code: string, name: string][]): CodeNameSeed[] {
  return list.map(([code, name]) => ({ code, name }));
}

/** ISO 3166-1 alpha-2 - a representative starting set, not the full ~250-entry list; a tenant extends it via the masters API. */
const COUNTRY_SEEDS: CodeNameSeed[] = pairs([
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
  ["SA", "Saudi Arabia"],
  ["ZA", "South Africa"],
]);

/** ISO 4217 - a representative starting set covering the currencies docs/spec/Purchase-V2.md names explicitly (USD, AED, EUR). */
const CURRENCY_SEEDS: CodeNameSeed[] = pairs([
  ["USD", "US Dollar"],
  ["EUR", "Euro"],
  ["GBP", "British Pound"],
  ["AED", "UAE Dirham"],
  ["INR", "Indian Rupee"],
  ["CNY", "Chinese Yuan"],
  ["JPY", "Japanese Yen"],
  ["SGD", "Singapore Dollar"],
  ["SAR", "Saudi Riyal"],
]);

/** Incoterms 2020 defines exactly these 11 terms - this list IS complete, unlike the other three. */
const INCOTERM_SEEDS: CodeNameSeed[] = pairs([
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
]);

/** Task item 4 names these three by code explicitly (MT, KG, LB); PC/CBM added as common additions a trading company also needs. */
const UOM_SEEDS: CodeNameSeed[] = pairs([
  ["MT", "Metric Ton"],
  ["KG", "Kilogram"],
  ["LB", "Pound"],
  ["PC", "Piece"],
  ["CBM", "Cubic Meter"],
]);

/**
 * Seeds the four masters docs/spec/Purchase-V2.md's provisioning task item
 * 4 names as needing "real reference data" - the other 11 masters (ports,
 * warehouses, vessels, ...) have no such list to seed; a company creates
 * those rows itself via the masters API. Company-scoped (unlike the old
 * tenant-wide reference_masters this replaces): each company gets its own
 * copy, matching every other master's company_id scoping (CLAUDE.md's
 * table conventions). Idempotent: onConflictDoUpdate against each master's
 * own (company_id, code) unique index.
 */
export async function seedMasterData(input: SeedMasterDataInput): Promise<void> {
  await withTenantSchema(input.schemaName, async (tx) => {
    async function seed<T extends MasterTable>(table: T, seeds: CodeNameSeed[]): Promise<void> {
      // See repository.ts's doc comment on `raw` - the same drizzle-orm
      // generic-table-parameter limitation applies to .insert()/.values()
      // here.
      const raw = table as unknown as PgTable;
      for (const [index, seedRow] of seeds.entries()) {
        await tx
          .insert(raw)
          .values({
            companyId: input.companyId,
            code: seedRow.code,
            name: seedRow.name,
            sortOrder: index,
            createdBy: input.createdBy,
          })
          .onConflictDoUpdate({
            target: [table.companyId, table.code],
            targetWhere: sql`${table.deletedAt} is null`,
            set: { name: seedRow.name, sortOrder: index, updatedBy: input.createdBy, updatedAt: new Date() },
          });
      }
    }

    // Sequential, not batched: small fixed-size seed lists, run once per company.
    await seed(countries, COUNTRY_SEEDS);
    await seed(currencies, CURRENCY_SEEDS);
    await seed(incoterms, INCOTERM_SEEDS);
    await seed(uom, UOM_SEEDS);
  });
}
