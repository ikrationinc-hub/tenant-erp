CREATE TYPE "purchase_line_status" AS ENUM('open', 'partial', 'short_closed', 'fully_received');--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "short_closed_qty" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD COLUMN "line_status" "purchase_line_status" DEFAULT 'open' NOT NULL;
