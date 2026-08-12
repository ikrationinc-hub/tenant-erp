import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { companies, users } from "../src/database/tenant/schema.js";
import { seedDefaultNumberSeries } from "../src/core/provisioning/seed-number-series.js";

/**
 * One-off: Prompt 22 added SUPPLIER_INVOICE to seed-number-series.ts's
 * DEFAULT_SERIES, but - same gap as the permission catalogue - that list
 * is only walked at (re)provisioning time. An already-active tenant's
 * companies never get a SUPPLIER_INVOICE number_series row on their own,
 * so nextNumber() throws "No number series configured" the first time
 * anyone tries to create a supplier invoice. seedDefaultNumberSeries is
 * itself idempotent (onConflictDoNothing per company/branch/docType/FY),
 * so re-running it here for every company of every active tenant is safe
 * - existing PO/SUPPLIER/BROKER rows are untouched, only the missing
 * SUPPLIER_INVOICE row gets inserted.
 */
async function backfillTenant(schemaName: string): Promise<void> {
  const companyRows = await withTenantSchema(schemaName, (tx) => tx.select().from(companies));

  for (const company of companyRows) {
    const [anyUser] = await withTenantSchema(schemaName, (tx) =>
      tx.select().from(users).where(eq(users.companyId, company.id)).limit(1),
    );
    if (!anyUser) continue;

    await seedDefaultNumberSeries({ schemaName, companyId: company.id, createdBy: anyUser.id });
    logger.info({ schemaName, companyId: company.id, companyName: company.name }, "number series backfilled");
  }
}

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
  for (const tenant of activeTenants) {
    await backfillTenant(tenant.schemaName);
    console.log(`  ${tenant.slug} (${tenant.schemaName}): done`);
  }
  console.log(`\nOK: ${activeTenants.length} tenant(s) processed\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "number series backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
