CREATE TYPE "purchase_invoice_status" AS ENUM('draft', 'approved', 'reversed');--> statement-breakpoint
ALTER TYPE "stock_movement_type" ADD VALUE 'purchase_reversal';--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"purchase_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"supplier_invoice_no" text,
	"invoice_date" date NOT NULL,
	"status" "purchase_invoice_status" DEFAULT 'draft' NOT NULL,
	"invoice_amount_usd" numeric(18, 2),
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "purchase_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "reversal_of_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_invoices_company_id_invoice_number_key" ON "purchase_invoices" USING btree ("company_id","invoice_number") WHERE "purchase_invoices"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "purchase_invoices_purchase_id_idx" ON "purchase_invoices" USING btree ("purchase_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_movement_id_stock_movements_id_fk" FOREIGN KEY ("reversal_of_movement_id") REFERENCES "stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_purchase_invoice_id_idx" ON "stock_movements" USING btree ("purchase_invoice_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_matches_type" CHECK (("stock_movements"."movement_type"::text = 'purchase_receipt' AND "stock_movements"."quantity" > 0) OR ("stock_movements"."movement_type"::text = 'purchase_reversal' AND "stock_movements"."quantity" < 0));