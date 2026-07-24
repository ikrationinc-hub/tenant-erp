import { z } from "zod";

export const branchesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
});
export type BranchesListQuery = z.infer<typeof branchesListQuerySchema>;

/** No `companyId` field, deliberately (task item 3) - it's never accepted from the request body, only injected from ctx.tenantScope.companyId. */
export const createBranchSchema = z
  .object({
    name: z.string().min(1).max(200),
    code: z.string().min(1).max(50),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    code: z.string().min(1).max(50).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
