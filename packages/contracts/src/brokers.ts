import { z } from "zod";

/**
 * Mirrors apps/api's brokers.validator.ts brokerContactSchema/
 * brokerBankSchema exactly - same "sub-table, not field-definitions-driven"
 * shape as suppliers.ts's SupplierContact/SupplierBank (Prompt 21 item 4:
 * broker is its own full module, mirroring Supplier's shape).
 */
export const brokerContactSchema = z.object({
  contactPerson: z.string().min(1).max(200),
  mobile: z.string().optional(),
  email: z.email().optional(),
});
export type BrokerContact = z.infer<typeof brokerContactSchema>;

export const brokerBankSchema = z.object({
  details: z.string().min(1),
});
export type BrokerBank = z.infer<typeof brokerBankSchema>;
