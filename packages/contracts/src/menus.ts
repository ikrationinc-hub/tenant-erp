import { z } from "zod";

/**
 * Mirrors apps/api/src/core/menu-engine/resolve.ts's MenuNode exactly -
 * already a resolved tree (permission/module/visibility gates applied
 * server-side), not a flat parentId list the client would need to build a
 * tree from itself.
 */
export interface MenuNode {
  id: string;
  key: string;
  label: string;
  path: string | null;
  icon: string | null;
  sortOrder: number;
  children: MenuNode[];
}

export const menuNodeSchema: z.ZodType<MenuNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    key: z.string(),
    label: z.string(),
    path: z.string().nullable(),
    icon: z.string().nullable(),
    sortOrder: z.number(),
    children: z.array(menuNodeSchema),
  }),
);

// --- GET /api/v1/menus -------------------------------------------------

export const menuTreeResponseSchema = z.object({
  menus: z.array(menuNodeSchema),
});
export type MenuTreeResponse = z.infer<typeof menuTreeResponseSchema>;
