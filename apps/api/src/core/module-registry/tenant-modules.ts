import { and, eq } from "drizzle-orm";
import { db } from "../../config/db.js";
import { tenantModules } from "../../database/platform/schema.js";
import { withTenantSchema } from "../../database/get-db.js";
import { companies } from "../../database/tenant/schema.js";
import { bumpMenuVersion } from "../menu-engine/cache.js";
import type { ModuleManifest } from "./types.js";

// Deliberately does NOT import registry.js: this module is reached from
// core/menu-engine/resolve.ts, which is reached from every module's
// controller (including modules mounted via the registry itself) -
// importing RESOLVED_MODULES here would create manifests.ts -> a
// module's routes -> ... -> tenant-modules.ts -> registry.ts ->
// manifests.ts, a genuine circular import. seedTenantModules takes the
// manifest list as a parameter instead; only provisioner.ts (which is
// outside that cycle) needs to import registry.ts directly to supply it.

/**
 * Absence of a row means disabled (fail-closed), not enabled - a module
 * added to the registry after a tenant was provisioned, with no backfill
 * run yet, should not silently start working for that tenant.
 * seedTenantModules below is what keeps this the rare case: every
 * registered module gets an explicit row at provisioning time.
 */
export async function isModuleEnabledForTenant(tenantId: string, moduleKey: string): Promise<boolean> {
  const [row] = await db
    .select({ enabled: tenantModules.enabled })
    .from(tenantModules)
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey)))
    .limit(1);
  return row?.enabled ?? false;
}

/** Called once by core/tenant/provisioner.ts right after a tenant's schema is created - every registered module starts enabled. */
export async function seedTenantModules(tenantId: string, manifests: ModuleManifest[]): Promise<void> {
  for (const manifest of manifests) {
    await db
      .insert(tenantModules)
      .values({ tenantId, moduleKey: manifest.key, enabled: true })
      .onConflictDoNothing();
  }
}

/**
 * The only way a module's enabled state changes for a tenant. Bumps
 * menu_version for every company in the tenant, not just role_version -
 * a module being turned off can hide menu items that reference it
 * (menus.module_key) even though no role or menu row changed, so the
 * existing per-user permission cache (core/rbac/cache.ts) alone wouldn't
 * invalidate the stale menu tree.
 */
export async function setModuleEnabled(
  tenantId: string,
  schemaName: string,
  moduleKey: string,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(tenantModules)
    .values({ tenantId, moduleKey, enabled })
    .onConflictDoUpdate({
      target: [tenantModules.tenantId, tenantModules.moduleKey],
      set: { enabled, updatedAt: new Date() },
    });

  const companyRows = await withTenantSchema(schemaName, (tx) =>
    tx.select({ id: companies.id }).from(companies),
  );
  await Promise.all(companyRows.map((company) => bumpMenuVersion(company.id)));
}
