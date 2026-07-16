CREATE SCHEMA "platform";
--> statement-breakpoint
CREATE TYPE "platform"."platform_admin_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "platform"."tenant_status" AS ENUM('provisioning', 'active', 'suspended');--> statement-breakpoint
CREATE TABLE "platform"."platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"status" "platform"."platform_admin_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."tenant_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"schema_name" text NOT NULL,
	"status" "platform"."tenant_status" DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform"."tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform"."platform_admins" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_key_key" ON "platform"."tenant_modules" USING btree ("tenant_id","module_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "platform"."tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_schema_name_key" ON "platform"."tenants" USING btree ("schema_name");