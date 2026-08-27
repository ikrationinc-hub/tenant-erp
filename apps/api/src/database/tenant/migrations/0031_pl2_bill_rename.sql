ALTER TYPE "purchase_invoice_status" RENAME TO "purchase_bill_status";--> statement-breakpoint
ALTER TYPE "purchase_bill_status" ADD VALUE 'paid';--> statement-breakpoint
ALTER TABLE "purchase_invoices" RENAME TO "purchase_bills";--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME COLUMN "invoice_number" TO "bill_number";--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME COLUMN "invoice_date" TO "bill_date";--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME COLUMN "invoice_amount_usd" TO "bill_amount_usd";--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "purchase_bills" ADD COLUMN "tax_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME CONSTRAINT "purchase_invoices_company_id_companies_id_fk" TO "purchase_bills_company_id_companies_id_fk";--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME CONSTRAINT "purchase_invoices_branch_id_branches_id_fk" TO "purchase_bills_branch_id_branches_id_fk";--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME CONSTRAINT "purchase_invoices_purchase_id_purchases_id_fk" TO "purchase_bills_purchase_id_purchases_id_fk";--> statement-breakpoint
ALTER TABLE "purchase_bills" RENAME CONSTRAINT "purchase_invoices_approved_by_users_id_fk" TO "purchase_bills_approved_by_users_id_fk";--> statement-breakpoint
ALTER INDEX "purchase_invoices_company_id_invoice_number_key" RENAME TO "purchase_bills_company_id_bill_number_key";--> statement-breakpoint
ALTER INDEX "purchase_invoices_purchase_id_idx" RENAME TO "purchase_bills_purchase_id_idx";--> statement-breakpoint
ALTER TABLE "stock_movements" RENAME CONSTRAINT "stock_movements_purchase_invoice_id_purchase_invoices_id_fk" TO "stock_movements_purchase_invoice_id_purchase_bills_id_fk";--> statement-breakpoint
CREATE TABLE "purchase_bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"billed_quantity" numeric(18, 6) NOT NULL,
	"billed_amount_usd" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_bill_items" ADD CONSTRAINT "purchase_bill_items_bill_id_purchase_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "purchase_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_items" ADD CONSTRAINT "purchase_bill_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_bill_items" ADD CONSTRAINT "purchase_bill_items_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_bill_items_bill_id_idx" ON "purchase_bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "purchase_bill_items_purchase_item_id_idx" ON "purchase_bill_items" USING btree ("purchase_item_id");
