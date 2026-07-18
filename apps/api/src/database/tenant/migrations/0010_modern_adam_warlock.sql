CREATE TYPE "field_data_type" AS ENUM('text', 'textarea', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select');--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "tier" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "data_type" "field_data_type" NOT NULL DEFAULT 'text';--> statement-breakpoint
ALTER TABLE "field_definitions" ALTER COLUMN "data_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "is_editable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "default_value" text;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "options_source" text;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "validation_json" jsonb;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_tier_check" CHECK ("field_definitions"."tier" = 2);