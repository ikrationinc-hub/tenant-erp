CREATE TABLE "sales_dashboard_country_breakdown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"country_id" uuid NOT NULL,
	"sales_amount_usd" numeric(18, 2) NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_dashboard_customer_breakdown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"customer_id" uuid NOT NULL,
	"sales_amount_usd" numeric(18, 2) NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_dashboard_item_breakdown" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"item_id" uuid NOT NULL,
	"sales_amount_usd" numeric(18, 2) NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_dashboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"total_sales_usd" numeric(18, 2) NOT NULL,
	"gross_profit_usd" numeric(18, 2) NOT NULL,
	"net_profit_usd" numeric(18, 2) NOT NULL,
	"outstanding_receivables_usd" numeric(18, 2) NOT NULL,
	"shipment_pending_count" integer NOT NULL,
	"open_contracts_count" integer NOT NULL,
	"completed_contracts_count" integer NOT NULL,
	"total_purchases_usd" numeric(18, 2) NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_dashboard_country_breakdown" ADD CONSTRAINT "sales_dashboard_country_breakdown_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_dashboard_country_breakdown" ADD CONSTRAINT "sales_dashboard_country_breakdown_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_dashboard_customer_breakdown" ADD CONSTRAINT "sales_dashboard_customer_breakdown_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_dashboard_customer_breakdown" ADD CONSTRAINT "sales_dashboard_customer_breakdown_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_dashboard_item_breakdown" ADD CONSTRAINT "sales_dashboard_item_breakdown_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_dashboard_item_breakdown" ADD CONSTRAINT "sales_dashboard_item_breakdown_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_dashboard_snapshots" ADD CONSTRAINT "sales_dashboard_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_dashboard_country_breakdown_key" ON "sales_dashboard_country_breakdown" USING btree ("company_id","period_month","country_id");--> statement-breakpoint
CREATE INDEX "sales_dashboard_country_breakdown_period_idx" ON "sales_dashboard_country_breakdown" USING btree ("company_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_dashboard_customer_breakdown_key" ON "sales_dashboard_customer_breakdown" USING btree ("company_id","period_month","customer_id");--> statement-breakpoint
CREATE INDEX "sales_dashboard_customer_breakdown_period_idx" ON "sales_dashboard_customer_breakdown" USING btree ("company_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_dashboard_item_breakdown_key" ON "sales_dashboard_item_breakdown" USING btree ("company_id","period_month","item_id");--> statement-breakpoint
CREATE INDEX "sales_dashboard_item_breakdown_period_idx" ON "sales_dashboard_item_breakdown" USING btree ("company_id","period_month");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_dashboard_snapshots_company_id_period_month_key" ON "sales_dashboard_snapshots" USING btree ("company_id","period_month");