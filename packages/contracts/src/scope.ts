import { z } from "zod";

/**
 * Powers the header's company/branch switcher (FE-2). No backend prompt has
 * specced this endpoint yet - masters/company listing lands in backend
 * prompt 12. Modeled the same way field-definitions was in FE-1: a
 * forward-looking contract + MSW mock so the frontend isn't blocked on
 * backend sequencing. Replace/reconcile with the real shape when
 * GET /api/v1/users/me/companies (or equivalent) is actually built.
 */
export const branchSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;

export const companySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  branches: z.array(branchSummarySchema),
});
export type CompanySummary = z.infer<typeof companySummarySchema>;

// --- GET /api/v1/users/me/companies -----------------------------------------

export const myCompaniesResponseSchema = z.object({
  companies: z.array(companySummarySchema),
});
export type MyCompaniesResponse = z.infer<typeof myCompaniesResponseSchema>;
