import { z } from "zod";

/** Mirrors mastersListQuerySchema's page/pageSize/search conventions (task item 1) - companies have no isActive/parentValue equivalent, so this isn't a `.extend()` of that schema, just the same shape. */
export const companiesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
});
export type CompaniesListQuery = z.infer<typeof companiesListQuerySchema>;

/**
 * `.strict()`: an unrecognized field (e.g. a stray `countryCode` from an
 * older client) should 422, not silently vanish - the same reasoning as
 * users.validator.ts's inviteUserSchema.
 */
export const createCompanySchema = z
  .object({
    name: z.string().min(1).max(200),
    countryId: z.string().uuid(),
    currencyId: z.string().uuid(),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    timezone: z.string().min(1),
    taxRegistrationNo: z.string().min(1).optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    countryId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    timezone: z.string().min(1).optional(),
    taxRegistrationNo: z.string().min(1).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
  })
  .strict();
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
