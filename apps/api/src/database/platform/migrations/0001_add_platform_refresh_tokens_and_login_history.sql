CREATE TYPE "platform"."platform_login_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "platform"."platform_login_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_admin_id" uuid,
	"attempted_email" text NOT NULL,
	"outcome" "platform"."platform_login_outcome" NOT NULL,
	"reason" text,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."platform_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_admin_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."platform_login_history" ADD CONSTRAINT "platform_login_history_platform_admin_id_platform_admins_id_fk" FOREIGN KEY ("platform_admin_id") REFERENCES "platform"."platform_admins"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."platform_refresh_tokens" ADD CONSTRAINT "platform_refresh_tokens_platform_admin_id_platform_admins_id_fk" FOREIGN KEY ("platform_admin_id") REFERENCES "platform"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_login_history_platform_admin_id_idx" ON "platform"."platform_login_history" USING btree ("platform_admin_id");--> statement-breakpoint
CREATE INDEX "platform_login_history_attempted_email_idx" ON "platform"."platform_login_history" USING btree ("attempted_email");--> statement-breakpoint
CREATE INDEX "platform_refresh_tokens_family_id_idx" ON "platform"."platform_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "platform_refresh_tokens_platform_admin_id_idx" ON "platform"."platform_refresh_tokens" USING btree ("platform_admin_id");