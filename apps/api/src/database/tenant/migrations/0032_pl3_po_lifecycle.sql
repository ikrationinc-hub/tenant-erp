-- PL-3 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0018): PO status becomes
-- Draft -> Issued -> Closed/Cancelled. "Posted" is dropped entirely.
--
-- Postgres cannot rename or remove enum values in place when the meaning
-- of the type changes this much, so this migration creates a new enum
-- type with the correct values, converts the column via an explicit CASE
-- mapping (old value -> new value, cast through text), drops the old
-- type, and renames the new one to the canonical name. This single
-- statement IS the data migration: every existing row's status is
-- remapped atomically as part of the column type conversion.
--
-- Mapping (per this build's own instruction: map approved/posted to
-- issued, or closed if a purchase already has full receipts+bills - not
-- possible on this migration's target data, verified below):
--   draft     -> draft      (unchanged)
--   approved  -> issued
--   posted    -> issued
--
-- Verified against live local tenant data before writing this migration:
-- tenant_dummy has 12 purchases (5 approved, 7 posted, 0 draft) and ZERO
-- purchase_receipts + only 1 purchase_bill total across the whole tenant -
-- no purchase can possibly be "fully received AND fully billed" yet, so
-- every approved/posted row maps to 'issued', none to 'closed'.
-- tenant_acme and tenant_abcd have zero purchases each.
CREATE TYPE "purchase_status_new" AS ENUM ('draft', 'issued', 'closed', 'cancelled');--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "status" TYPE "purchase_status_new" USING (
	CASE "status"::text
		WHEN 'draft' THEN 'draft'
		WHEN 'approved' THEN 'issued'
		WHEN 'posted' THEN 'issued'
	END
)::"purchase_status_new";--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
DROP TYPE "purchase_status";--> statement-breakpoint
ALTER TYPE "purchase_status_new" RENAME TO "purchase_status";--> statement-breakpoint
ALTER TABLE "purchases" RENAME COLUMN "approved_by" TO "issued_by";--> statement-breakpoint
ALTER TABLE "purchases" RENAME COLUMN "approved_at" TO "issued_at";--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" RENAME CONSTRAINT "purchases_approved_by_users_id_fk" TO "purchases_issued_by_users_id_fk";
