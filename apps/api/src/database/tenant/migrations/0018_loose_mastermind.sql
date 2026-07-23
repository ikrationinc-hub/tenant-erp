CREATE TYPE "hedge_position" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "hedge_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "market_price_source" AS ENUM('manual');--> statement-breakpoint
CREATE TABLE "hedges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"hedge_platform_id" uuid NOT NULL,
	"contract_number" text NOT NULL,
	"position" "hedge_position" NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"hedge_date" date NOT NULL,
	"status" "hedge_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lme_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"lme_exchange_id" uuid NOT NULL,
	"market_price_id" uuid NOT NULL,
	"lme_price_usd" numeric(18, 6) NOT NULL,
	"fixing_date" date NOT NULL,
	"agreed_premium_pct" numeric(18, 6) NOT NULL,
	"final_purchase_rate_usd" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lme_exchange_id" uuid NOT NULL,
	"metal" text NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"effective_date" date NOT NULL,
	"source" "market_price_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hedges" ADD CONSTRAINT "hedges_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hedges" ADD CONSTRAINT "hedges_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hedges" ADD CONSTRAINT "hedges_hedge_platform_id_hedge_platforms_id_fk" FOREIGN KEY ("hedge_platform_id") REFERENCES "hedge_platforms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lme_records" ADD CONSTRAINT "lme_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lme_records" ADD CONSTRAINT "lme_records_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lme_records" ADD CONSTRAINT "lme_records_lme_exchange_id_lme_exchanges_id_fk" FOREIGN KEY ("lme_exchange_id") REFERENCES "lme_exchanges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lme_records" ADD CONSTRAINT "lme_records_market_price_id_market_prices_id_fk" FOREIGN KEY ("market_price_id") REFERENCES "market_prices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_lme_exchange_id_lme_exchanges_id_fk" FOREIGN KEY ("lme_exchange_id") REFERENCES "lme_exchanges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hedges_purchase_id_idx" ON "hedges" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "lme_records_purchase_id_idx" ON "lme_records" USING btree ("purchase_id");