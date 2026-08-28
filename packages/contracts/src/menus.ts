import { z } from "zod";

/**
 * Mirrors apps/api/src/core/menu-engine/resolve.ts's MenuNode exactly -
 * already a resolved tree (permission/module/visibility gates applied
 * server-side), not a flat parentId list the client would need to build a
 * tree from itself.
 *
 * `section` distinguishes daily "operate" screens (main sidebar) from
 * "configure" screens (Settings area) - a navigation/UI concern only, not a
 * permission: `requiredPermission`/`moduleKey` still gate visibility exactly
 * as before, `section` just tells the frontend which shell to render a
 * visible node into.
 */
export type MenuSection = "operate" | "settings";

export interface MenuNode {
  id: string;
  key: string;
  label: string;
  path: string | null;
  icon: string | null;
  sortOrder: number;
  section: MenuSection;
  /**
   * The Settings launcher's top-level heading this node's card sits under
   * (e.g. "Organization Settings", "Master Data") - null for every
   * "operate" node and for a "settings" node not shown on the launcher.
   * Presentational only: never gates visibility or affects routing/the
   * settings sub-nav tree, which both ignore it entirely.
   */
  launcherSection: string | null;
  /**
   * The launcher card this node's link is grouped under within its
   * launcherSection (e.g. "Users & Roles", "Geography") - null alongside
   * launcherSection for the same reasons.
   */
  launcherGroup: string | null;
  children: MenuNode[];
}

export const menuSectionSchema = z.enum(["operate", "settings"]);

export const menuNodeSchema: z.ZodType<MenuNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    key: z.string(),
    label: z.string(),
    path: z.string().nullable(),
    icon: z.string().nullable(),
    sortOrder: z.number(),
    section: menuSectionSchema,
    launcherSection: z.string().nullable(),
    launcherGroup: z.string().nullable(),
    children: z.array(menuNodeSchema),
  }),
);

// --- GET /api/v1/menus -------------------------------------------------

export const menuTreeResponseSchema = z.object({
  menus: z.array(menuNodeSchema),
});
export type MenuTreeResponse = z.infer<typeof menuTreeResponseSchema>;
