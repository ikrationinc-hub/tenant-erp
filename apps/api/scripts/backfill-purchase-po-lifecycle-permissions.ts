import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { permissions, roles, rolePermissions, users } from "../src/database/tenant/schema.js";
import { seedPermissionCatalogue } from "../src/core/rbac/seed.js";
import { grantPermissionToRole } from "../src/core/rbac/mutations.js";

/**
 * One-off: PL-3 replaced purchase.po.approve/purchase.po.post with
 * purchase.po.issue/purchase.po.cancel in manifests.ts - same gap
 * backfill-purchase-receipt-permissions.ts and
 * backfill-purchase-invoice-permissions.ts closed for their own new keys.
 * seedPermissionCatalogue only runs at (re)provisioning time, so an
 * already-active tenant never picks up a manifest rename on its own -
 * its permissions table still has the old approve/post rows (harmless
 * orphans, nothing references them anymore) but is missing issue/cancel
 * entirely, which is what produces "Unknown permission \"purchase.po.issue\""
 * from roles.service.ts's grantPermission/revokePermission the moment
 * anything tries to reference the new key against an old tenant.
 *
 * This upserts the catalogue for every active tenant (adds the 2 new
 * rows, leaves the 2 old orphaned rows alone - deleting them is a
 * separate, riskier cleanup this script deliberately doesn't attempt),
 * then grants the 2 new keys to whichever of a tenant's default SYSTEM
 * roles already carry the matching tier (same ROLE_PERMISSION_FILTERS
 * shape as seed-roles.ts's own issue/cancel inclusion at Manager),
 * skipping any role+permission pair already granted. Custom, non-default
 * roles are left untouched - same policy the receipt/invoice backfills
 * already established for this exact class of script.
 */
const NEW_KEYS = ["purchase.po.issue", "purchase.po.cancel"] as const;
const ROLE_ACTION_FILTERS: Record<string, (action: string) => boolean> = {
  Viewer: (action) => action === "read",
  Officer: (action) => ["read", "create", "update"].includes(action),
  Manager: (action) => ["read", "create", "update", "approve", "confirm", "issue", "cancel", "assign", "provision"].includes(action),
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
    await closeTenantDbPool();
    await closeDbPool();
  });
