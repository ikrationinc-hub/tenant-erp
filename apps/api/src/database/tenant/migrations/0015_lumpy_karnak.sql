CREATE TYPE "purchase_status" AS ENUM('draft', 'approved', 'posted');--> statement-breakpoint
CREATE TABLE "purchase_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"shipment_year" integer NOT NULL,
	"lot_number" text NOT NULL,
	"container_number" text NOT NULL,
	"bl_no" text NOT NULL,
	"loading_date" date NOT NULL,
	"transport_mode_id" uuid NOT NULL,
	"vessel_id" uuid,
	"voyage_number" text,
	"port_of_loading_id" uuid NOT NULL,
	"port_of_discharge_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"incoterm_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"purchase_number" text NOT NULL,
	"purchase_date" date NOT NULL,
	"status" "purchase_status" DEFAULT 'draft' NOT NULL,
	"branch_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_no" text,
	"supplier_reference_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_transport_mode_id_transport_modes_id_fk" FOREIGN KEY ("transport_mode_id") REFERENCES "transport_modes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_vessel_id_vessels_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_port_of_loading_id_ports_id_fk" FOREIGN KEY ("port_of_loading_id") REFERENCES "ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_port_of_discharge_id_ports_id_fk" FOREIGN KEY ("port_of_discharge_id") REFERENCES "ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_shipments" ADD CONSTRAINT "purchase_shipments_incoterm_id_incoterms_id_fk" FOREIGN KEY ("incoterm_id") REFERENCES "incoterms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_shipments_purchase_id_key" ON "purchase_shipments" USING btree ("purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_company_id_purchase_number_key" ON "purchases" USING btree ("company_id","purchase_number") WHERE "purchases"."deleted_at" is null;