import { z } from "zod";

/**
 * json-rules-engine's own TopLevelCondition shape, reconstructed loosely
 * here (not a field-by-field re-implementation of the library's own
 * grammar - this schema's only job is "is this plausibly a condition
 * tree", not full validation; the library itself throws at evaluation
 * time if a condition is malformed, which is the real, authoritative
 * check). Recursive via z.lazy since a condition can nest arbitrarily.
 */
const leafConditionSchema = z
  .object({
    fact: z.string().min(1),
    operator: z.string().min(1),
    value: z.unknown(),
  })
  .passthrough();

const topLevelConditionSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(z.union([leafConditionSchema, topLevelConditionSchema])).min(1) }).passthrough(),
    z.object({ any: z.array(z.union([leafConditionSchema, topLevelConditionSchema])).min(1) }).passthrough(),
    z.object({ not: z.union([leafConditionSchema, topLevelConditionSchema]) }).passthrough(),
    z.object({ condition: z.string().min(1) }).passthrough(),
  ]),
);

export const createClauseRuleSchema = z
  .object({
    name: z.string().min(1),
    divisionId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    conditionJson: topLevelConditionSchema,
    targetClauseId: z.string().uuid(),
    actionIsMandatory: z.boolean().optional(),
  })
  .strict();
export type CreateClauseRuleInput = z.infer<typeof createClauseRuleSchema>;

/** isExample is deliberately absent from this schema too (see clause-rules.service.ts's own doc comment on create()) - never PATCH-able. */
export const updateClauseRuleSchema = z
  .object({
    name: z.string().min(1).optional(),
    conditionJson: topLevelConditionSchema.optional(),
    actionIsMandatory: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateClauseRuleInput = z.infer<typeof updateClauseRuleSchema>;

export const clauseRuleIdParamsSchema = z.object({
  id: z.string().uuid(),
});
