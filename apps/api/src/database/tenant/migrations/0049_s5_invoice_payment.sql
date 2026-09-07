CREATE TYPE "sales_invoice_status" AS ENUM('draft', 'approved', 'reversed', 'paid');--> statement-breakpoint
CREATE TYPE "sales_payment_mode" AS ENUM('cash', 'cheque', 'bank_transfer', 'other');--> statement-breakpoint
CREATE TABLE "payments_received" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"customer_id" uuid NOT NULL,
	"payment_number" text NOT NULL,
	"payment_date" date NOT NULL,
	"payment_mode" "sales_payment_mode" NOT NULL,
	"reference_number" text,
	"payment_amount_usd" numeric(18, 2) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_item_id" uuid NOT NULL,
	"invoiced_quantity" numeric(18, 6) NOT NULL,
	"invoiced_amount_usd" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"sales_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"customer_reference_no" text,
	"invoice_date" date NOT NULL,
	"due_date" date,
	"status" "sales_invoice_status" DEFAULT 'draft' NOT NULL,
	"invoice_amount_usd" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2),
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
CREATE TABLE "sales_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"applied_amount_usd" numeric(18, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_received" ADD CONSTRAINT "payments_received_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoice_items" ADD CONSTRAINT "sales_invoice_items_sales_item_id_sales_items_id_fk" FOREIGN KEY ("sales_item_id") REFERENCES "sales_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_sales_id_sales_id_fk" FOREIGN KEY ("sales_id") REFERENCES "sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_payment_allocations" ADD CONSTRAINT "sales_payment_allocations_payment_id_payments_received_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments_received"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_payment_allocations" ADD CONSTRAINT "sales_payment_allocations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_payment_allocations" ADD CONSTRAINT "sales_payment_allocations_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_received_company_id_payment_number_key" ON "payments_received" USING btree ("company_id","payment_number") WHERE "payments_received"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "payments_received_customer_id_idx" ON "payments_received" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_items_invoice_id_idx" ON "sales_invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_invoice_items_sales_item_id_idx" ON "sales_invoice_items" USING btree ("sales_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_invoices_company_id_invoice_number_key" ON "sales_invoices" USING btree ("company_id","invoice_number") WHERE "sales_invoices"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sales_invoices_sales_id_idx" ON "sales_invoices" USING btree ("sales_id");--> statement-breakpoint
CREATE INDEX "sales_payment_allocations_payment_id_idx" ON "sales_payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "sales_payment_allocations_invoice_id_idx" ON "sales_payment_allocations" USING btree ("invoice_id");