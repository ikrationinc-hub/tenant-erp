import type { TenantTx } from "../../database/get-db.js";
import type { MarketPriceRow } from "./market-prices.repository.js";

export interface RecordPriceInput {
  companyId: string;
  lmeExchangeId: string;
  /** Free text - the base metal (Copper, Aluminum, ...), not an `items` FK. See schema.ts's doc comment on market_prices. */
  metal: string;
  /** A decimal string (rule 1) - never a JS number, not even here. */
  price: string;
  effectiveDate: string;
  createdBy: string;
}

/**
 * "Prices go into market_prices first, NEVER straight onto a transaction.
 * Put a PriceSource interface in front... so a live feed drops in later
 * without touching purchase code" (this task's own instruction). Every
 * caller that wants a price recorded goes through this interface, never
 * `insertMarketPrice` directly - purchase-lme.service.ts (today) and
 * whatever a future live-feed integration looks like both depend on this
 * shape, not on how a price actually arrives.
 */
export interface PriceSource {
  recordPrice(tx: TenantTx, input: RecordPriceInput): Promise<MarketPriceRow>;
}
