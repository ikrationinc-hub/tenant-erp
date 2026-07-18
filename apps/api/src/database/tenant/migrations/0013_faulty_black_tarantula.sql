CREATE TYPE "item_type" AS ENUM('metals', 'electronics', 'toys');--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "item_type" "item_type" NOT NULL;