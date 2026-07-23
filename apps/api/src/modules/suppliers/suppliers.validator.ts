import { z } from "zod";

/** Permissive on purpose - international supplier phone numbers vary in format (spec: "Validation"). */
const mobileSchema = z.string().regex(/^\+?[0-9\s()-]{6,20}$/, "Invalid mobile number");

const supplierContactSchema = z.object({
  contactPerson: z.string().min(1).max(200),
  mobile: mobileSchema.optional(),
  email: z.string().email().optional(),
});
export type SupplierContactInput = z.infer<typeof supplierContactSchema>;

const supplierBankSchema = z.object({
  details: z.string().min(1),
});
export type SupplierBankInput = z.infer<typeof supplierBankSchema>;

/**
 * `.strict()`: every field here is exactly what docs/spec/Purchase-V2.md's
 * Sub Tab 1 table names, no more, no less - an unrecognized field is
 * rejected rather than silently dropped, so a client typo doesn't quietly
 * lose data (same reasoning as users.validator.ts's inviteUserSchema).
 * `code` and `status` are never accepted here: code is FR-002's
 * auto-generated value, and a new supplier is always "active" (FR-004's
 * activate/deactivate endpoints are the only way to change status).
 */
export const createSupplierSchema = z
  .object({
    name: z.string().min(1).max(200),
    supplierTypeId: z.string().uuid(),
    countryId: z.string().uuid(),
    cityId: z.string().uuid().optional(),
    address: z.string().min(1).optional(),
    taxRegistrationNo: z.string().min(1).max(100).optional(),
    paymentTermId: z.string().uuid(),
    currencyId: z.string().uuid(),
    remarks: z.string().min(1).optional(),
    contacts: z.array(supplierContactSchema).optional(),
    banks: z.array(supplierBankSchema).optional(),
  })
  .strict();
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/**
 * Same field set as create, all optional (a PATCH touches only what it
 * sends) - except `contacts`/`banks`: when present, that whole collection is
 * REPLACED (soft-delete the old rows, insert the new ones), not merged
 * item-by-item. `code` and `status` stay unpatchable here for the same
 * reasons as create.
 */
export const updateSupplierSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    supplierTypeId: z.string().uuid().optional(),
    countryId: z.string().uuid().optional(),
    cityId: z.string().uuid().optional(),
    address: z.string().min(1).optional(),
    taxRegistrationNo: z.string().min(1).max(100).optional(),
    paymentTermId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    remarks: z.string().min(1).optional(),
    contacts: z.array(supplierContactSchema).optional(),
    banks: z.array(supplierBankSchema).optional(),
  })
  .strict();
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const supplierIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const suppliersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type SuppliersListQuery = z.infer<typeof suppliersListQuerySchema>;

export const suppliersOptionsQuerySchema = z.object({
  search: z.string().min(1).optional(),
});
export type SuppliersOptionsQuery = z.infer<typeof suppliersOptionsQuerySchema>;
