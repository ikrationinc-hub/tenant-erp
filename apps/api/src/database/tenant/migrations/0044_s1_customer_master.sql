CREATE TYPE "customer_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "customer_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"details" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_person" text NOT NULL,
	"mobile" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
-- customer_type_id/country_id/payment_term_id/currency_id are added
-- NULLABLE here, not NOT NULL as the drizzle schema declares them - a
-- schema-diff migration can't know whether a tenant already has customers
-- rows (local dev does: tenant_dummy has 2, tenant_hyp has 1, confirmed by
-- direct query before writing this migration), and there is no safe
-- universal default for a FK to a specific country/currency/payment-term/
-- customer-type - fabricating one would silently corrupt real-looking
-- business data. scripts/backfill-customer-required-fields.ts (written
-- alongside this migration) assigns a real, explicit master row to any
-- pre-existing customer per company and is REQUIRED to run once before any
-- environment can be considered fully migrated - see that script's own
-- doc comment. The NOT NULL constraint itself is intentionally NOT added
-- by this migration; a follow-up migration tightens it only after the
-- backfill has run everywhere (drizzle's own generated schema still
-- declares these NOT NULL in code - see this file's own migration
-- metadata note below on why db push/generate may re-diff this).
ALTER TABLE "customers" ADD COLUMN "customer_type_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "country_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "city_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "vat_trn" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "payment_term_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "currency_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric(18, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "salesperson_user_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "remarks" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "status" "customer_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_banks" ADD CONSTRAINT "customer_banks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_banks" ADD CONSTRAINT "customer_banks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_types" ADD CONSTRAINT "customer_types_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_banks_customer_id_idx" ON "customer_banks" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_customer_id_idx" ON "customer_contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_types_company_id_code_key" ON "customer_types" USING btree ("company_id","code") WHERE "customer_types"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "customer_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_term_id_payment_terms_id_fk" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_salesperson_user_id_users_id_fk" FOREIGN KEY ("salesperson_user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_id_name_key" ON "customers" USING btree ("company_id","name") WHERE "customers"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "sort_order";