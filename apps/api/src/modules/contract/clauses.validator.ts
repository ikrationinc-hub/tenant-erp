import { z } from "zod";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const clauseCategorySchema = z.enum(["general_tc", "division_specific"]);
export const clauseVersionStatusSchema = z.enum(["draft", "approved", "active", "superseded", "expired"]);

export const createClauseSchema = z
  .object({
    clauseTitle: z.string().min(1),
    divisionId: z.string().uuid().optional(),
    category: clauseCategorySchema,
    /**
     * A clause is created together with its first version - there is no
     * such thing as a clause with zero versions (clause_versions is the
     * only place clauseText ever lives). Same required-changeReason rule
     * as addClauseVersionSchema below.
     */
    clauseText: z.string().min(1),
    effectiveFrom: dateStringSchema,
    changeReason: z.string().min(1),
  })
  .strict();
export type CreateClauseInput = z.infer<typeof createClauseSchema>;

/**
 * changeReason is REQUIRED (docs/CONTRACT-MODULE-BUILD.md C-1 item 3) - a
 * version without one is rejected here, at the wire boundary, rather than
 * relying on a DB constraint that can't usefully express "must be a
 * meaningful reason".
 */
export const addClauseVersionSchema = z
  .object({
    clauseText: z.string().min(1),
    effectiveFrom: dateStringSchema,
    changeReason: z.string().min(1),
  })
  .strict();
export type AddClauseVersionInput = z.infer<typeof addClauseVersionSchema>;

export const clauseIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const clauseVersionIdParamsSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

export const clausesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  divisionId: z.string().uuid().optional(),
  category: clauseCategorySchema.optional(),
});
export type ClausesListQuery = z.infer<typeof clausesListQuerySchema>;
