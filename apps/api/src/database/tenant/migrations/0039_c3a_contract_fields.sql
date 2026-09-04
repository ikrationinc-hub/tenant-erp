CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"division_id" uuid,
	"material_type" text,
	"weight_kg" numeric(18, 6),
	"rate_usd" numeric(18, 2),
	"delivery_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
DROP INDEX "field_definitions_company_module_entity_field_key";--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "division_id" uuid;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_division_id_idx" ON "contracts" USING btree ("division_id");--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_company_module_entity_field_key_division" ON "field_definitions" USING btree ("company_id","module","entity","field_key","division_id") WHERE "field_definitions"."deleted_at" is null and "field_definitions"."division_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_company_module_entity_field_key_all_divisions" ON "field_definitions" USING btree ("company_id","module","entity","field_key") WHERE "field_definitions"."deleted_at" is null and "field_definitions"."division_id" is null;