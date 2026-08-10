CREATE TYPE "broker_commission_type" AS ENUM('percentage', 'flat');--> statement-breakpoint
CREATE TYPE "broker_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "lme_type" AS ENUM('open', 'close', 'cash');--> statement-breakpoint
CREATE TYPE "purchase_pricing_type" AS ENUM('lme', 'fixed');--> statement-breakpoint
CREATE TABLE "broker_banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_id" uuid NOT NULL,
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
CREATE TABLE "broker_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_id" uuid NOT NULL,
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
CREATE TABLE "brokers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "broker_status" DEFAULT 'active' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"container_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisions" (
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
ALTER TABLE "lme_records" ADD COLUMN "lme_type" "lme_type";--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "division_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "pricing_type" "purchase_pricing_type";--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "broker_id" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "broker_commission" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "broker_commission_type" "broker_commission_type";--> statement-breakpoint
ALTER TABLE "broker_banks" ADD CONSTRAINT "broker_banks_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_banks" ADD CONSTRAINT "broker_banks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_contacts" ADD CONSTRAINT "broker_contacts_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_contacts" ADD CONSTRAINT "broker_contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brokers" ADD CONSTRAINT "brokers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "containers" ADD CONSTRAINT "containers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broker_banks_broker_id_idx" ON "broker_banks" USING btree ("broker_id");--> statement-breakpoint
CREATE INDEX "broker_contacts_broker_id_idx" ON "broker_contacts" USING btree ("broker_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brokers_company_id_name_key" ON "brokers" USING btree ("company_id","name") WHERE "brokers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "brokers_company_id_code_key" ON "brokers" USING btree ("company_id","code") WHERE "brokers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "containers_company_id_code_key" ON "containers" USING btree ("company_id","code") WHERE "containers"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "divisions_company_id_code_key" ON "divisions" USING btree ("company_id","code") WHERE "divisions"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_broker_id_brokers_id_fk" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE restrict ON UPDATE no action;