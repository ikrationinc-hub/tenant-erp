CREATE TABLE "customers" (
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
CREATE TABLE "purchase_additional_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"freight" numeric(18, 2) DEFAULT '0' NOT NULL,
	"insurance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"customs" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_charges_2" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_charges_3" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"reserved_customer_id" uuid NOT NULL,
	"allocation_pct" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_additional_costs" ADD CONSTRAINT "purchase_additional_costs_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_additional_costs" ADD CONSTRAINT "purchase_additional_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_allocations" ADD CONSTRAINT "purchase_allocations_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_allocations" ADD CONSTRAINT "purchase_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_allocations" ADD CONSTRAINT "purchase_allocations_reserved_customer_id_customers_id_fk" FOREIGN KEY ("reserved_customer_id") REFERENCES "customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_company_id_code_key" ON "customers" USING btree ("company_id","code") WHERE "customers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_additional_costs_purchase_id_key" ON "purchase_additional_costs" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_allocations_purchase_id_idx" ON "purchase_allocations" USING btree ("purchase_id");