-- Follow-up to 0044_s1_customer_master.sql: tightens customer_type_id/
-- country_id/payment_term_id/currency_id to NOT NULL, matching what
-- database/tenant/schema.ts's customers table has always declared in
-- code. 0044 deliberately left these nullable because a schema-diff
-- migration can't safely default a FK for pre-existing rows; every active
-- tenant's pre-existing customer rows must be backfilled first via
-- scripts/backfill-customer-required-fields.ts (idempotent, safe to
-- re-run) before this migration is applied - confirmed clean (0 remaining
-- NULLs across all 4 local tenants) before writing this file.
ALTER TABLE "customers" ALTER COLUMN "customer_type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "country_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "payment_term_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "currency_id" SET NOT NULL;