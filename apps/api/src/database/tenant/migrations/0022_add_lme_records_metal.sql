ALTER TABLE "lme_records" ADD COLUMN "metal" text;--> statement-breakpoint
UPDATE "lme_records" SET "metal" = "market_prices"."metal" FROM "market_prices" WHERE "market_prices"."id" = "lme_records"."market_price_id";--> statement-breakpoint
ALTER TABLE "lme_records" ALTER COLUMN "metal" SET NOT NULL;
