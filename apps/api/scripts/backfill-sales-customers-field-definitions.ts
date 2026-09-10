import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { seedDefaultFieldDefinitions } from "../src/core/provisioning/seed-field-definitions.js";
import { closeTenantDbPool, withTenantSchema } from "../src/database/get-db.js";
import { companies } from "../src/database/tenant/schema.js";
import { tenants } from "../src/database/platform/schema.js";

/**
 * One-off: `sales` and `customers` were added to core/field-engine/
 * defaults.ts (S-1 through S-6, docs/SALES-MODULE-PLAN.md) AFTER several
 * tenants/companies were already provisioned - seedDefaultFieldDefinitions
 * only ever runs once, at provision-company.ts's own provisioning time, so
 * an already-active company's field_definitions table never got rows for
 * either module. resolve.ts's own fallback-to-code-defaults means every
 * sales/customer screen still renders correctly today (no visible symptom),
 * but a company can't PATCH /field-definitions/:id to customize a
 * sales/customer field's label/mandatory/order - there's no row id to
 * target. seedDefaultFieldDefinitions is documented as re-run-safe
 * (onConflictDoUpdate against the (company_id, module, entity, field_key)
 * unique index) and already re-seeds EVERY module in FIELD_DEFAULTS, not
 * just new ones - so running it again per company is the correct backfill,
 * not new logic.
 */
async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));

  let companyCount = 0;
  for (const tenant of activeTenants) {
    const tenantCompanies = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(companies));
    for (const company of tenantCompanies) {
      await seedDefaultFieldDefinitions({
        schemaName: tenant.schemaName,
        companyId: company.id,
        createdBy: company.createdBy,
      });
      companyCount += 1;
      console.log(`  ${tenant.slug} (${tenant.schemaName}) / ${company.name}: field definitions re-seeded`);
    }
  }

  console.log(`\nOK: ${companyCount} company(ies) processed across ${activeTenants.length} tenant(s)\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "sales/customers field-definitions backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
