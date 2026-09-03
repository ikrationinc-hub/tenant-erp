import { z } from "zod";

const decimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a positive decimal number as a string");
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/**
 * C-3b (docs/CONTRACT-MODULE-BUILD.md Part 2): LINK or STANDALONE (item 3) -
 * `source` is optional; when present, both fields are required together
 * (a source_type with no source_id, or vice versa, is meaningless).
 * materialType/weightKg/rateUsd/deliveryTerms remain the PLACEHOLDER Scrap
 * field set from C-3a (see defaults.ts) - unchanged here, not yet
 * client-confirmed.
 */
const sourceLinkSchema = z
  .object({
    sourceType: z.enum(["purchase", "sale"]),
    sourceId: z.string().uuid(),
  })
  .strict();

const partySchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
  })
  .strict()
  .refine((party) => (party.supplierId ? 1 : 0) + (party.customerId ? 1 : 0) === 1, {
    message: "Exactly one of supplierId or customerId is required",
  });

export const createContractSchema = z
  .object({
    divisionId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    templateId: z.string().uuid().optional(),
    contractDate: dateStringSchema,
    source: sourceLinkSchema.optional(),
    seller: partySchema.optional(),
    buyer: partySchema.optional(),
    materialType: z.string().min(1).optional(),
    weightKg: decimalStringSchema.optional(),
    rateUsd: decimalStringSchema.optional(),
    deliveryTerms: z.string().min(1).optional(),
  })
  .strict();
export type CreateContractInput = z.infer<typeof createContractSchema>;

/** Draft-only (enforced in the service, not here) - the header fields a contract can still edit before Approve. Never contractNumber/status/templateId/source* - those are set once at create and never PATCH-able. */
export const updateContractSchema = z
  .object({
    divisionId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
    contractDate: dateStringSchema.optional(),
    seller: partySchema.optional(),
    buyer: partySchema.optional(),
    materialType: z.string().min(1).optional(),
    weightKg: decimalStringSchema.optional(),
    rateUsd: decimalStringSchema.optional(),
    deliveryTerms: z.string().min(1).optional(),
  })
  .strict();
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

export const contractIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const contractsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.enum(["draft", "approved", "signed", "closed"]).optional(),
  divisionId: z.string().uuid().optional(),
});
export type ContractsListQuery = z.infer<typeof contractsListQuerySchema>;

// --- Assembly (item 5) ------------------------------------------------------

export const addContractClauseSchema = z
  .object({
    clauseId: z.string().uuid(),
  })
  .strict();
export type AddContractClauseInput = z.infer<typeof addContractClauseSchema>;

export const reorderContractClausesSchema = z
  .object({
    /** The full ordered list of this contract's own contract_clauses row ids - simplest correct representation of "the new order" the drag-and-drop UI can send in one call. */
    contractClauseIds: z.array(z.string().uuid()).min(1),
  })
  .strict();
export type ReorderContractClausesInput = z.infer<typeof reorderContractClausesSchema>;

export const editContractClauseTextSchema = z
  .object({
    resolvedText: z.string().min(1),
  })
  .strict();
export type EditContractClauseTextInput = z.infer<typeof editContractClauseTextSchema>;

export const contractClauseIdParamsSchema = z.object({
  id: z.string().uuid(),
  contractClauseId: z.string().uuid(),
});

export const generationJobIdParamsSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().min(1),
});
