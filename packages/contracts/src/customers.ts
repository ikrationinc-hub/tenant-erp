import { z } from "zod";

/**
 * Mirrors apps/api's customers.validator.ts customerContactSchema/
 * customerBankSchema exactly (S-1, docs/SALES-MODULE-PLAN.md) - same
 * pattern as suppliers.ts's own contact/bank schemas, since these two
 * sub-tables aren't field-definitions-driven (no fieldType in the 13-type
 * spec fits a repeating row group). CustomerContactsEditor/
 * CustomerBanksEditor are the bespoke, fixed-shape components, same
 * category as SupplierContactsEditor/SupplierBanksEditor.
 */
export const customerContactSchema = z.object({
  contactPerson: z.string().min(1).max(200),
  mobile: z.string().optional(),
  email: z.email().optional(),
});
export type CustomerContact = z.infer<typeof customerContactSchema>;

export const customerBankSchema = z.object({
  details: z.string().min(1),
});
export type CustomerBank = z.infer<typeof customerBankSchema>;
