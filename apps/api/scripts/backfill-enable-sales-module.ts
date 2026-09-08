import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { setModuleEnabled, isModuleEnabledForTenant } from "../src/core/module-registry/tenant-modules.js";
import { closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";

/**
 * One-off: the "sales" module (S-3, docs/SALES-MODULE-PLAN.md) was added
 * to core/module-registry/manifests.ts AFTER several tenants were already
 * provisioned - seedTenantModules only runs once, at provisioning time, so
 * an already-active tenant's tenant_modules table never got a "sales" row
 * at all. isModuleEnabledForTenant fails closed (no row = disabled), which
 * would make the new "Sales" menu entry and every /sales/* route silently
 * 404/never appear for these tenants - same shape of gap
 * backfill-enable-customers-module.ts closed for "customers".
 */
const MODULE_KEY = "sales";

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));

  let enabledCount = 0;
  let alreadyCount = 0;
  for (const tenant of activeTenants) {
    const alreadyEnabled = await isModuleEnabledForTenant(tenant.id, MODULE_KEY);
    if (alreadyEnabled) {
      alreadyCount += 1;
      console.log(`  ${tenant.slug} (${tenant.schemaName}): already enabled`);
      continue;
    }
    await setModuleEnabled(tenant.id, tenant.schemaName, MODULE_KEY, true);
    enabledCount += 1;
    logger.info({ schemaName: tenant.schemaName, slug: tenant.slug }, "sales module enabled");
    console.log(`  ${tenant.slug} (${tenant.schemaName}): enabled`);
  }

  console.log(`\nOK: ${activeTenants.length} tenant(s) processed - ${enabledCount} newly enabled, ${alreadyCount} already enabled\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "sales module enablement backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
