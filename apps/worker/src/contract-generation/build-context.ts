import type { PlaceholderContext } from "./placeholder-resolver.js";

/**
 * C-2's proposed token namespace (docs/CONTRACT-MODULE-BUILD.md Part 6:
 * "Placeholder namespace - which fields can a clause reference? Propose a
 * set from the contract sections + linked purchase/sale; client
 * confirms."). THIS IS A PROPOSAL, not a client-confirmed shape - see
 * this module's ADR. Money/quantity fields are decimal STRINGS
 * (CLAUDE.md rule 1) - never a JS number - so they can be formatted by
 * placeholder-resolver.ts's formatMoney without ever passing through
 * parseFloat.
 */
export interface GenerationContextInput {
  seller: { name: string; address: string };
  buyer: { name: string; address: string };
  commercial: { rate: string; currency: string; quantity: string };
  shipment: { port: string; eta: string };
  payment: { terms: string; dueDate: string };
}

/** MONEY_TOKENS: which dotted paths in the namespace above must render with thousands-separator + fixed 2dp formatting, vs. verbatim (dates, names, free text). */
export const MONEY_TOKENS = ["commercial.rate"] as const;

export function buildGenerationContext(input: GenerationContextInput): PlaceholderContext {
  return {
    seller: { name: input.seller.name, address: input.seller.address },
    buyer: { name: input.buyer.name, address: input.buyer.address },
    commercial: {
      rate: input.commercial.rate,
      currency: input.commercial.currency,
      quantity: input.commercial.quantity,
    },
    shipment: { port: input.shipment.port, eta: input.shipment.eta },
    payment: { terms: input.payment.terms, dueDate: input.payment.dueDate },
  };
}
