import { z } from "zod";

/** Permissive on purpose - same reasoning as suppliers.validator.ts's mobileSchema (international numbers vary in format). */
const mobileSchema = z.string().regex(/^\+?[0-9\s()-]{6,20}$/, "Invalid mobile number");

const brokerContactSchema = z.object({
  contactPerson: z.string().min(1).max(200),
  mobile: mobileSchema.optional(),
  email: z.string().email().optional(),
});
export type BrokerContactInput = z.infer<typeof brokerContactSchema>;

const brokerBankSchema = z.object({
  details: z.string().min(1),
});
export type BrokerBankInput = z.infer<typeof brokerBankSchema>;

/**
 * Prompt 21 item 4: mirrors suppliers.validator.ts's createSupplierSchema
 * shape (contacts/banks as replace-on-update collections, `.strict()`,
 * code/status unpatchable) but narrower - no supplierTypeId/countryId/
 * cityId/paymentTermId/currencyId, since a broker is a commission-earning
 * intermediary, not a trading counterparty with its own terms/currency.
 */
export const createBrokerSchema = z
  .object({
    name: z.string().min(1).max(200),
    remarks: z.string().min(1).optional(),
    contacts: z.array(brokerContactSchema).optional(),
    banks: z.array(brokerBankSchema).optional(),
  })
  .strict();
export type CreateBrokerInput = z.infer<typeof createBrokerSchema>;

export const updateBrokerSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    remarks: z.string().min(1).optional(),
    contacts: z.array(brokerContactSchema).optional(),
    banks: z.array(brokerBankSchema).optional(),
  })
  .strict();
export type UpdateBrokerInput = z.infer<typeof updateBrokerSchema>;

export const brokerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const brokersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().min(1).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
export type BrokersListQuery = z.infer<typeof brokersListQuerySchema>;

export const brokersOptionsQuerySchema = z.object({
  search: z.string().min(1).optional(),
});
export type BrokersOptionsQuery = z.infer<typeof brokersOptionsQuerySchema>;
