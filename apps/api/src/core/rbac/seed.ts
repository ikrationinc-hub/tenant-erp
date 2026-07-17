import { withTenantSchema } from "../../database/get-db.js";
import { permissions } from "../../database/tenant/schema.js";

export interface PermissionCatalogueEntry {
  key: string;
  module: string;
  entity: string;
  action: string;
  description: string;
}

function entry(
  module: string,
  entity: string,
  action: string,
  description: string,
): PermissionCatalogueEntry {
  return { key: `${module}.${entity}.${action}`, module, entity, action, description };
}

/**
 * Static for now - "registry comes later" (task item 6). Once a real
 * module registry exists, this list is generated from each module's
 * manifest instead of hand-maintained here.
 */
export const PERMISSION_CATALOGUE: PermissionCatalogueEntry[] = [
  entry("masters", "supplier", "create", "Create a supplier master record"),
  entry("masters", "supplier", "read", "View supplier master records"),
  entry("masters", "supplier", "update", "Edit a supplier master record"),
  entry("masters", "supplier", "delete", "Remove a supplier master record"),

  entry("masters", "customer", "create", "Create a customer master record"),
  entry("masters", "customer", "read", "View customer master records"),
  entry("masters", "customer", "update", "Edit a customer master record"),
  entry("masters", "customer", "delete", "Remove a customer master record"),

  entry("purchase", "po", "create", "Create a purchase order"),
  entry("purchase", "po", "read", "View purchase orders"),
  entry("purchase", "po", "update", "Edit a draft purchase order"),
  entry("purchase", "po", "approve", "Approve a purchase order"),
  entry("purchase", "po", "delete", "Delete a draft purchase order"),

  entry("users", "user", "create", "Invite a new user"),
  entry("users", "user", "read", "View users"),
  entry("users", "user", "update", "Edit a user"),
  entry("users", "user", "delete", "Deactivate a user"),
  entry(
    "users",
    "user",
    "provision",
    "Provision a user with a temporary password, bypassing the email invite flow (no email address)",
  ),

  entry("roles", "role", "create", "Create a role"),
  entry("roles", "role", "read", "View roles"),
  entry("roles", "role", "update", "Edit a role's permissions"),
  entry("roles", "role", "assign", "Assign a role to a user"),
  entry("roles", "role", "delete", "Remove a role"),
];

/** Idempotent, re-runnable: upserts every catalogue entry by its unique key. */
export async function seedPermissionCatalogue(schemaName: string): Promise<void> {
  await withTenantSchema(schemaName, async (tx) => {
    for (const item of PERMISSION_CATALOGUE) {
      await tx
        .insert(permissions)
        .values(item)
        .onConflictDoUpdate({
          target: permissions.key,
          set: {
            module: item.module,
            entity: item.entity,
            action: item.action,
            description: item.description,
            updatedAt: new Date(),
          },
        });
    }
  });
}
