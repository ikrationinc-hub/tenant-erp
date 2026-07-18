import { z } from "zod";

/**
 * The generic pattern establishes pagination/search/filter query shape
 * from scratch (CLAUDE.md rule 10 - no prior list endpoint in this
 * codebase paginates yet). page/pageSize over limit/offset: matches an
 * admin "master data" grid's natural UI vocabulary: mastersListQuerySchema
 * is the base every master's own list-query schema `.extend()`s with its
 * own extra filter keys (e.g. cities' countryId).
 */
export const mastersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  isActive: z.coerce.boolean().optional(),
  /** Cascading filter, e.g. a country id when listing cities - a no-op for a master with no configured parent. */
  parentValue: z.string().min(1).optional(),
});
export type MastersListQuery = z.infer<typeof mastersListQuerySchema>;

export const mastersOptionsQuerySchema = z.object({
  search: z.string().min(1).optional(),
  parentValue: z.string().min(1).optional(),
});
export type MastersOptionsQuery = z.infer<typeof mastersOptionsQuerySchema>;

/** code/name/isActive/sortOrder - the fixed columns every master has. Extended per-master with that master's own extra required/optional fields, then `.strict()`d at the point of use. */
export const masterCreateBaseSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type MasterCreateBase = z.infer<typeof masterCreateBaseSchema>;

export const masterIdParamsSchema = z.object({
  id: z.string().uuid(),
});
