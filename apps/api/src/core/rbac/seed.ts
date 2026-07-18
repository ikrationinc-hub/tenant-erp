import { withTenantSchema } from "../../database/get-db.js";
import { permissions } from "../../database/tenant/schema.js";
import { getPermissionCatalogue } from "../module-registry/registry.js";
import type { PermissionCatalogueEntry } from "./types.js";

export type { PermissionCatalogueEntry } from "./types.js";

/** Idempotent, re-runnable: upserts every catalogue entry (sourced from every registered module's manifest.permissions) by its unique key. */
export async function seedPermissionCatalogue(schemaName: string): Promise<void> {
  const catalogue: PermissionCatalogueEntry[] = getPermissionCatalogue();

  await withTenantSchema(schemaName, async (tx) => {
    for (const item of catalogue) {
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
