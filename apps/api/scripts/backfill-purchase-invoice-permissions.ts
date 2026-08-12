import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { permissions, roles, rolePermissions, users } from "../src/database/tenant/schema.js";
import { seedPermissionCatalogue } from "../src/core/rbac/seed.js";
import { grantPermissionToRole } from "../src/core/rbac/mutations.js";

/**
 * One-off: Prompt 22 added purchase.invoice.create/update/approve to
 * manifests.ts, but seedPermissionCatalogue only runs at (re)provisioning
 * time - already-active tenants never pick up a manifest addition on
 * their own. This upserts the catalogue for every active tenant, then
 * grants the 3 new keys to whichever of its default roles already carry
 * the matching tier (same ROLE_PERMISSION_FILTERS as seed-roles.ts:
 * create/update -> Officer+, approve -> Manager+), skipping any
 * role+permission pair already granted.
 */
const NEW_KEYS = ["purchase.invoice.create", "purchase.invoice.update", "purchase.invoice.approve"] as const;
const ROLE_ACTION_FILTERS: Record<string, (action: string) => boolean> = {
  Viewer: (action) => action === "read",
  Officer: (action) => ["read", "create", "update"].includes(action),
  Manager: (action) => ["read", "create", "update", "approve", "assign", "provision"].includes(action),
  Admin: () => true,
};

interface PendingGrant {
  companyId: string;
  roleId: string;
  roleName: string;
  permissionId: string;
  permissionKey: string;
  createdBy: string;
}

async function backfillTenant(schemaName: string): Promise<void> {
  await seedPermissionCatalogue(schemaName);

  const pending = await withTenantSchema(schemaName, async (tx) => {
    const newPermissionRows = await tx.select().from(permissions).where(eq(permissions.module, "purchase"));
    const relevant = newPermissionRows.filter((p) => (NEW_KEYS as readonly string[]).includes(p.key));

    const roleRows = await tx.select().from(roles);
    const existingGrants = await tx.select().from(rolePermissions);
    const grantedSet = new Set(existingGrants.map((g) => `${g.roleId}:${g.permissionId}`));

    const result: PendingGrant[] = [];
    for (const role of roleRows) {
      const filter = role.isSystem ? ROLE_ACTION_FILTERS[role.name] : undefined;
      if (!filter) continue; // custom, non-default roles are left untouched

      const [anyUser] = await tx.select().from(users).where(eq(users.companyId, role.companyId)).limit(1);
      if (!anyUser) continue;

      for (const permission of relevant) {
        if (!filter(permission.action)) continue;
        if (grantedSet.has(`${role.id}:${permission.id}`)) continue;

        result.push({
          companyId: role.companyId,
          roleId: role.id,
          roleName: role.name,
          permissionId: permission.id,
          permissionKey: permission.key,
          createdBy: anyUser.id,
        });
      }
    }
    return result;
  });

  for (const grant of pending) {
    await grantPermissionToRole(schemaName, grant.companyId, grant.roleId, grant.permissionId, grant.createdBy);
    logger.info({ schemaName, role: grant.roleName, permission: grant.permissionKey }, "granted");
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
    logger.error({ err: error }, "permission backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
