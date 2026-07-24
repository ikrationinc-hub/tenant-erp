import { z } from "zod";

/**
 * Mirrors apps/api's suppliers.validator.ts supplierContactSchema/
 * supplierBankSchema exactly. These two sub-tables aren't field-
 * definitions-driven (no fieldType in the 13-type spec fits a repeating
 * row group) - SupplierContactsEditor/SupplierBanksEditor are the
 * bespoke, fixed-shape components FE-6 calls "sub-tables", the same
 * category as FE-5.5's PermissionAssignment.
 */
export const supplierContactSchema = z.object({
  contactPerson: z.string().min(1).max(200),
  mobile: z.string().optional(),
  email: z.email().optional(),
});
export type SupplierContact = z.infer<typeof supplierContactSchema>;

export const supplierBankSchema = z.object({
  details: z.string().min(1),
});
export type SupplierBank = z.infer<typeof supplierBankSchema>;
