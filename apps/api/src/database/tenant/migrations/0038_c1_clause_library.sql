CREATE TYPE "clause_category" AS ENUM('general_tc', 'division_specific');--> statement-breakpoint
CREATE TYPE "clause_version_status" AS ENUM('draft', 'approved', 'active', 'superseded', 'expired');--> statement-breakpoint
CREATE TABLE "clause_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"clause_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"clause_text" text NOT NULL,
	"status" "clause_version_status" DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"clause_code" text NOT NULL,
	"clause_title" text NOT NULL,
	"division_id" uuid,
	"category" "clause_category" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clause_versions" ADD CONSTRAINT "clause_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_versions" ADD CONSTRAINT "clause_versions_clause_id_clauses_id_fk" FOREIGN KEY ("clause_id") REFERENCES "clauses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_versions" ADD CONSTRAINT "clause_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clauses" ADD CONSTRAINT "clauses_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clause_versions_clause_id_idx" ON "clause_versions" USING btree ("clause_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clause_versions_clause_id_version_number_key" ON "clause_versions" USING btree ("clause_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "clause_versions_one_active_per_clause" ON "clause_versions" USING btree ("clause_id") WHERE "clause_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "clauses_company_id_clause_code_key" ON "clauses" USING btree ("company_id","clause_code") WHERE "clauses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "clauses_division_id_idx" ON "clauses" USING btree ("division_id");