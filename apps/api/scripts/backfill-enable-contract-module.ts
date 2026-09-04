import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { setModuleEnabled, isModuleEnabledForTenant } from "../src/core/module-registry/tenant-modules.js";
import { closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";

/**
 * One-off: the "contract" module (C-1) was added to core/module-registry/
 * manifests.ts AFTER several tenants were already provisioned -
 * seedTenantModules only runs once, at provisioning time
 * (core/tenant/provisioner.ts), so an already-active tenant's
 * tenant_modules table never got a "contract" row at all. isModuleEnabled
 * ForTenant fails closed (no row = disabled), which is exactly why the
 * entire Contracts menu tree (both the operational "Contracts" node and
 * the Settings -> Contract admin screens) silently never appeared for
 * these tenants - menu-engine/resolve.ts filters out any node whose
 * moduleKey isn't enabled, regardless of the user's own permissions.
 *
 * setModuleEnabled (not the full applyModuleEnablement used at
 * provisioning) is used deliberately here - it touches only the ONE
 * module key given, an upsert on tenantId+moduleKey, and already bumps
 * every company's menu_version cache so the change is visible on the
 * user's very next request (no logout/login needed). Re-running
 * applyModuleEnablement instead would have required reconstructing this
 * tenant's ENTIRE currently-enabled module list first, since it sets
 * every registered module's flag (including to false for anything not
 * passed in) - unnecessary risk for a single-module backfill.
 */
const MODULE_KEY = "contract";

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
    logger.info({ schemaName: tenant.schemaName, slug: tenant.slug }, "contract module enabled");
    console.log(`  ${tenant.slug} (${tenant.schemaName}): enabled`);
  }

  console.log(`\nOK: ${activeTenants.length} tenant(s) processed - ${enabledCount} newly enabled, ${alreadyCount} already enabled\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "contract module enablement backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
