import { z } from "zod";

/**
 * Mirrors apps/api/src/core/masters/types.ts's PaginatedRows<TRow> - the
 * shape every server-side-paginated list endpoint returns (masters today;
 * suppliers/purchases follow the same page/pageSize/total/items envelope).
 * SchemaTable is entity-agnostic, so a row is an opaque record - it never
 * assumes a shape beyond what the resolved columns (field-definitions)
 * tell it to render (backend rule 10: paginated and filtered server-side,
 * never fetched whole and sliced client-side).
 */
export const paginatedRowsResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type PaginatedRowsResponse = z.infer<typeof paginatedRowsResponseSchema>;
