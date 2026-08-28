import { eq, sql } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { menus } from "../../database/tenant/schema.js";
import { bumpMenuVersion } from "./cache.js";

/**
 * The only way menu rows change - every mutation here bumps menu_version
 * for the company in the same breath as the write, mirroring
 * core/rbac/mutations.ts's role_version discipline exactly (task: cache
 * invalidates "on role, menu, or module change").
 */

export interface CreateMenuInput {
  schemaName: string;
  companyId: string;
  key: string;
  label: string;
  path?: string;
  icon?: string;
  parentId?: string;
  sortOrder?: number;
  requiredPermission?: string;
  moduleKey?: string;
  isVisible?: boolean;
  section?: "operate" | "settings";
  launcherSection?: string;
  launcherGroup?: string;
  createdBy: string;
}

/**
 * Upsert by (companyId, key) - NOT a plain insert. seed-menu-tree.ts's
 * seedDefaultMenuTree walks the whole default tree unconditionally, and
 * needs to be safely re-runnable against a tenant that was provisioned
 * before a node existed (e.g. a module added in a later release): without
 * this, re-running it either throws (duplicate key) or silently produces
 * a second, orphaned row for the same key. Mirrors core/rbac/seed.ts's
 * seedPermissionCatalogue's own "upsert every catalogue entry" idiom -
 * also keeps an existing tenant's label/path/icon/permission in sync if
 * DEFAULT_MENU_TREE's copy for that key changes later.
 */
export async function createMenu(input: CreateMenuInput): Promise<typeof menus.$inferSelect> {
  const menu = await withTenantSchema(input.schemaName, async (tx) => {
    const values = {
      companyId: input.companyId,
      key: input.key,
      label: input.label,
      sortOrder: input.sortOrder ?? 0,
      isVisible: input.isVisible ?? true,
      createdBy: input.createdBy,
      path: input.path ?? null,
      icon: input.icon ?? null,
      parentId: input.parentId ?? null,
      requiredPermission: input.requiredPermission ?? null,
      moduleKey: input.moduleKey ?? null,
      section: input.section ?? "operate",
      launcherSection: input.launcherSection ?? null,
      launcherGroup: input.launcherGroup ?? null,
    };
    const [upserted] = await tx
      .insert(menus)
      .values(values)
      .onConflictDoUpdate({
        target: [menus.companyId, menus.key],
        targetWhere: sql`${menus.deletedAt} is null`,
        set: {
          label: values.label,
          sortOrder: values.sortOrder,
          path: values.path,
          icon: values.icon,
          parentId: values.parentId,
          requiredPermission: values.requiredPermission,
          moduleKey: values.moduleKey,
          section: values.section,
          launcherSection: values.launcherSection,
          launcherGroup: values.launcherGroup,
          updatedBy: input.createdBy,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!upserted) {
      throw new Error("failed to upsert menu");
    }
    return upserted;
  });
  await bumpMenuVersion(input.companyId);
  return menu;
}

export async function setMenuVisibility(
  schemaName: string,
  companyId: string,
  menuId: string,
  isVisible: boolean,
  updatedBy: string,
): Promise<void> {
  await withTenantSchema(schemaName, (tx) =>
    tx.update(menus).set({ isVisible, updatedBy, updatedAt: new Date() }).where(eq(menus.id, menuId)),
  );
  await bumpMenuVersion(companyId);
}
