import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { permissions, roles, rolePermissions, users } from "../src/database/tenant/schema.js";
import { seedPermissionCatalogue } from "../src/core/rbac/seed.js";
import { grantPermissionToRole } from "../src/core/rbac/mutations.js";

/**
 * One-off: S-3 (docs/SALES-MODULE-PLAN.md) added the "sales" manifest with
 * its own sales.order.{create,read,update,approve,cancel} permission
 * namespace - seedPermissionCatalogue only runs at (re)provisioning time,
 * so an already-active tenant never picks up this new namespace on its
 * own. Same shape as backfill-customer-permissions.ts: upserts the
 * catalogue for every active tenant, then grants the new keys to whichever
 * of its default roles already carry the matching tier (a frozen local
 * copy of seed-roles.ts's ROLE_PERMISSION_FILTERS as it existed when this
 * script was written, per that file's own convention), skipping any
 * role+permission pair already granted.
 *
 * S-4 extended this same list with sales.delivery.{create,confirm} rather
 * than a new script - this script is idempotent (grantedSet skip) and safe
 * to re-run against tenants that already got the S-3 keys.
 */
const NEW_KEYS = [
  "sales.order.create",
  "sales.order.read",
  "sales.order.update",
  "sales.order.approve",
  "sales.order.cancel",
  "sales.delivery.create",
  "sales.delivery.confirm",
] as const;
const ROLE_ACTION_FILTERS: Record<string, (action: string) => boolean> = {
  Viewer: (action) => action === "read",
  Officer: (action) => ["read", "create", "update", "version", "edit", "generate"].includes(action),
  Manager: (action) =>
    ["read", "create", "update", "version", "edit", "generate", "approve", "confirm", "issue", "cancel", "record", "assign", "provision", "assemble"].includes(
      action,
    ),
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
    const newPermissionRows = await tx.select().from(permissions).where(eq(permissions.module, "sales"));
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
    logger.error({ err: error }, "sales permission backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
