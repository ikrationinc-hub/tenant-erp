CREATE TYPE "contract_esignature_status" AS ENUM('not_sent', 'sent', 'signed', 'declined');--> statement-breakpoint
CREATE TABLE "clause_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"division_id" uuid,
	"name" text NOT NULL,
	"condition_json" jsonb NOT NULL,
	"target_clause_id" uuid NOT NULL,
	"action_is_mandatory" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_example" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approval_requested_for" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approval_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "approval_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "esignature_status" "contract_esignature_status" DEFAULT 'not_sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "esignature_request_id" text;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "esignature_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "esignature_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "last_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "last_emailed_to" text;--> statement-breakpoint
ALTER TABLE "clause_rules" ADD CONSTRAINT "clause_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_rules" ADD CONSTRAINT "clause_rules_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_rules" ADD CONSTRAINT "clause_rules_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clause_rules" ADD CONSTRAINT "clause_rules_target_clause_id_clauses_id_fk" FOREIGN KEY ("target_clause_id") REFERENCES "clauses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clause_rules_division_id_idx" ON "clause_rules" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "clause_rules_target_clause_id_idx" ON "clause_rules" USING btree ("target_clause_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approval_requested_for_users_id_fk" FOREIGN KEY ("approval_requested_for") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approval_requested_by_users_id_fk" FOREIGN KEY ("approval_requested_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;