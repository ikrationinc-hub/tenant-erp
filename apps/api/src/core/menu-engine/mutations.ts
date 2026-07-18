import { eq } from "drizzle-orm";
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
  createdBy: string;
}

export async function createMenu(input: CreateMenuInput): Promise<typeof menus.$inferSelect> {
  const menu = await withTenantSchema(input.schemaName, async (tx) => {
    const [inserted] = await tx
      .insert(menus)
      .values({
        companyId: input.companyId,
        key: input.key,
        label: input.label,
        sortOrder: input.sortOrder ?? 0,
        isVisible: input.isVisible ?? true,
        createdBy: input.createdBy,
        ...(input.path !== undefined ? { path: input.path } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.requiredPermission !== undefined
          ? { requiredPermission: input.requiredPermission }
          : {}),
        ...(input.moduleKey !== undefined ? { moduleKey: input.moduleKey } : {}),
      })
      .returning();
    if (!inserted) {
      throw new Error("failed to insert menu");
    }
    return inserted;
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
