CREATE TYPE "contract_party_role" AS ENUM('seller', 'buyer');--> statement-breakpoint
CREATE TYPE "contract_source_type" AS ENUM('purchase', 'sale');--> statement-breakpoint
CREATE TYPE "contract_status" AS ENUM('draft', 'approved', 'signed', 'closed');--> statement-breakpoint
CREATE TABLE "contract_clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"clause_id" uuid NOT NULL,
	"clause_version_id" uuid,
	"resolved_text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_from_rule" boolean DEFAULT false NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"snapshot_taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"party_role" "contract_party_role" NOT NULL,
	"supplier_id" uuid,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "contract_parties_exactly_one_party_check" CHECK (("contract_parties"."supplier_id" is not null)::int + ("contract_parties"."customer_id" is not null)::int = 1)
);
--> statement-breakpoint
CREATE TABLE "contract_template_clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"clause_id" uuid NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"division_id" uuid,
	"name" text NOT NULL,
	"contract_type" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
-- C-3b: contracts existed with no lifecycle before this migration (C-3a's
-- proof-of-concept table). Any pre-existing row has no natural
-- contract_number/contract_date to backfill to (they were never real
-- business documents, just the field-engine's own division-scoping
-- proof) - added nullable, then any surviving test rows are backfilled to
-- a placeholder before the NOT NULL is enforced, so this migration is
-- safe whether or not a prior environment already has rows.
ALTER TABLE "contracts" ADD COLUMN "contract_number" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "contract_date" date;--> statement-breakpoint
UPDATE "contracts" SET "contract_number" = 'LEGACY-' || "id", "contract_date" = "created_at"::date WHERE "contract_number" is null;--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "contract_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ALTER COLUMN "contract_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "status" "contract_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "parent_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "revision_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "source_type" "contract_source_type";--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "signed_by" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "clauses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_clauses" ADD CONSTRAINT "contract_clauses_clause_version_id_clause_versions_id_fk" FOREIGN KEY ("clause_version_id") REFERENCES "clause_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_parties" ADD CONSTRAINT "contract_parties_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_template_clauses" ADD CONSTRAINT "contract_template_clauses_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_template_clauses" ADD CONSTRAINT "contract_template_clauses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_template_clauses" ADD CONSTRAINT "contract_template_clauses_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "clauses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_clauses_contract_id_idx" ON "contract_clauses" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_clauses_contract_id_sort_order_key" ON "contract_clauses" USING btree ("contract_id","sort_order") WHERE "contract_clauses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contract_parties_contract_id_idx" ON "contract_parties" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_parties_contract_id_party_role_key" ON "contract_parties" USING btree ("contract_id","party_role") WHERE "contract_parties"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contract_template_clauses_template_id_idx" ON "contract_template_clauses" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_template_clauses_template_id_clause_id_key" ON "contract_template_clauses" USING btree ("template_id","clause_id") WHERE "contract_template_clauses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contract_templates_division_id_idx" ON "contract_templates" USING btree ("division_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_templates_company_id_name_key" ON "contract_templates" USING btree ("company_id","name") WHERE "contract_templates"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_parent_contract_id_contracts_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_parent_contract_id_idx" ON "contracts" USING btree ("parent_contract_id");--> statement-breakpoint
CREATE INDEX "contracts_source_idx" ON "contracts" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_company_id_contract_number_key" ON "contracts" USING btree ("company_id","contract_number") WHERE "contracts"."deleted_at" is null;