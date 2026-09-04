import { z } from "zod";

/** Permissive on purpose - international customer phone numbers vary in format (same reasoning as suppliers.validator.ts). */
const mobileSchema = z.string().regex(/^\+?[0-9\s()-]{6,20}$/, "Invalid mobile number");

/** Same convention as purchase-costs.validator.ts's amountStringSchema - a decimal STRING, never a JS number, matching CLAUDE.md rule 1 through the whole stack (decimal.js parsing happens at the repository boundary, not here). */
const amountStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "Expected a non-negative decimal number as a string");

const customerContactSchema = z.object({
  contactPerson: z.string().min(1).max(200),
  mobile: mobileSchema.optional(),
  email: z.string().email().optional(),
});
export type CustomerContactInput = z.infer<typeof customerContactSchema>;

const customerBankSchema = z.object({
  details: z.string().min(1),
});
export type CustomerBankInput = z.infer<typeof customerBankSchema>;

/**
 * `.strict()`, exact mirror of suppliers.validator.ts's createSupplierSchema
 * reasoning: an unrecognized field is rejected, not silently dropped.
 * `code` and `status` are never accepted here: code is the auto-generated
 * value (docType "CUSTOMER"), and a new customer is always "active"
 * (activate/deactivate are the only way to change status).
 */
export const createCustomerSchema = z
  .object({
    name: z.string().min(1).max(200),
    customerTypeId: z.string().uuid(),
    countryId: z.string().uuid(),
    cityId: z.string().uuid().optional(),
    address: z.string().min(1).optional(),
    vatTrn: z.string().min(1).max(100).optional(),
    paymentTermId: z.string().uuid(),
    currencyId: z.string().uuid(),
    creditLimit: amountStringSchema.optional(),
    salespersonUserId: z.string().uuid().optional(),
    remarks: z.string().min(1).optional(),
    contacts: z.array(customerContactSchema).optional(),
    banks: z.array(customerBankSchema).optional(),
  })
  .strict();
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/**
 * Same field set as create, all optional - except `contacts`/`banks`: when
 * present, that whole collection is REPLACED (soft-delete the old rows,
 * insert the new ones), not merged item-by-item. `code` and `status` stay
 * unpatchable here for the same reasons as create.
 */
export const updateCustomerSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    customerTypeId: z.string().uuid().optional(),
    countryId: z.string().uuid().optional(),
    cityId: z.string().uuid().optional(),
    address: z.string().min(1).optional(),
    vatTrn: z.string().min(1).max(100).optional(),
    paymentTermId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    creditLimit: amountStringSchema.optional(),
    salespersonUserId: z.string().uuid().optional(),
    remarks: z.string().min(1).optional(),
    contacts: z.array(customerContactSchema).optional(),
    banks: z.array(customerBankSchema).optional(),
  })
  .strict();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const customersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type CustomersListQuery = z.infer<typeof customersListQuerySchema>;

export const customersOptionsQuerySchema = z.object({
  search: z.string().min(1).optional(),
});
export type CustomersOptionsQuery = z.infer<typeof customersOptionsQuerySchema>;
