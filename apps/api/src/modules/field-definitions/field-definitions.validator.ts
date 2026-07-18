import { z } from "zod";

export const getFieldDefinitionsParamsSchema = z.object({
  module: z.string().min(1),
  entity: z.string().min(1),
});
export type GetFieldDefinitionsParams = z.infer<typeof getFieldDefinitionsParamsSchema>;

/**
 * `.strict()`, deliberately: field_key/data_type/tier/is_system are not
 * even optional fields here, they're structurally absent - an attempt to
 * send any of them is a 422, not a silently-ignored no-op (task item 4:
 * "data_type is NEVER overridable").
 */
export const updateFieldDefinitionSchema = z
  .object({
    label: z.string().min(1).optional(),
    isVisible: z.boolean().optional(),
    isMandatory: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
export type UpdateFieldDefinitionRequestBody = z.infer<typeof updateFieldDefinitionSchema>;
