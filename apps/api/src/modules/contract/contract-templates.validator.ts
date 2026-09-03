import { z } from "zod";

export const createContractTemplateSchema = z
  .object({
    name: z.string().min(1),
    contractType: z.string().min(1),
    divisionId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
  })
  .strict();
export type CreateContractTemplateInput = z.infer<typeof createContractTemplateSchema>;

export const updateContractTemplateSchema = z
  .object({
    name: z.string().min(1).optional(),
    contractType: z.string().min(1).optional(),
    divisionId: z.string().uuid().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateContractTemplateInput = z.infer<typeof updateContractTemplateSchema>;

export const contractTemplateIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const contractTemplatesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  divisionId: z.string().uuid().optional(),
});

export const addTemplateClauseSchema = z
  .object({
    clauseId: z.string().uuid(),
    isMandatory: z.boolean().optional(),
  })
  .strict();
export type AddTemplateClauseInput = z.infer<typeof addTemplateClauseSchema>;

export const templateClauseIdParamsSchema = z.object({
  id: z.string().uuid(),
  clauseId: z.string().uuid(),
});
