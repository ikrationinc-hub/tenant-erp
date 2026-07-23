import type { TenantTx } from "../../database/get-db.js";
import { insertMarketPrice, type MarketPriceRow } from "./market-prices.repository.js";
import type { PriceSource, RecordPriceInput } from "./price-source.js";

/** FR-201/FR-202: today's only `PriceSource` - a human enters a price directly (no external feed yet). Tags every row `source: "manual"`; a future live-feed adapter would implement the same interface and tag its own rows accordingly. */
export class ManualEntryAdapter implements PriceSource {
  async recordPrice(tx: TenantTx, input: RecordPriceInput): Promise<MarketPriceRow> {
    return insertMarketPrice(tx, {
      companyId: input.companyId,
      lmeExchangeId: input.lmeExchangeId,
      metal: input.metal,
      price: input.price,
      effectiveDate: input.effectiveDate,
      source: "manual",
      createdBy: input.createdBy,
    });
  }
}

export function getPriceSource(): PriceSource {
  return new ManualEntryAdapter();
}
