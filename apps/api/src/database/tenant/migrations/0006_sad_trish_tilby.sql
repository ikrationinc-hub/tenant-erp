CREATE TABLE "audit_logs" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "audit_logs_id_changed_at_pk" PRIMARY KEY("id","changed_at")
) PARTITION BY RANGE ("changed_at");
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_changed_by_idx" ON "audit_logs" USING btree ("changed_by");--> statement-breakpoint
CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;
