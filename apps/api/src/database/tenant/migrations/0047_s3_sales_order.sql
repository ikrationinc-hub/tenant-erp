CREATE TYPE "sales_pricing_type" AS ENUM('lme', 'fixed');--> statement-breakpoint
CREATE TYPE "sales_status" AS ENUM('draft', 'approved', 'closed', 'cancelled');--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_number" text NOT NULL,
	"sales_date" date NOT NULL,
	"status" "sales_status" DEFAULT 'draft' NOT NULL,
	"division_id" uuid,
	"branch_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_reference_no" text,
	"pricing_type" "sales_pricing_type",
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_additional_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"freight" numeric(18, 2) DEFAULT '0' NOT NULL,
	"insurance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"customs" numeric(18, 2) DEFAULT '0' NOT NULL,
	"other_charges" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_item_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_item_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"stock_lot_id" uuid NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"grade_id" uuid,
	"quantity" numeric(18, 6) NOT NULL,
	"uom_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_item_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"sales_rate_usd" numeric(18, 6) NOT NULL,
	"sales_amount_usd" numeric(18, 2) NOT NULL,
	"exchange_rate" numeric(18, 6) NOT NULL,
	"sales_amount_aed" numeric(18, 2) NOT NULL,
	"lme_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sales_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"shipment_year" integer NOT NULL,
	"lot_number" text NOT NULL,
	"container_id" uuid NOT NULL,
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
ALTER TABLE "sales" ADD CONSTRAINT "sales_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_seller_id_companies_id_fk" FOREIGN KEY ("seller_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_additional_costs" ADD CONSTRAINT "sales_additional_costs_sales_id_sales_id_fk" FOREIGN KEY ("sales_id") REFERENCES "sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_additional_costs" ADD CONSTRAINT "sales_additional_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_item_lots" ADD CONSTRAINT "sales_item_lots_sales_item_id_sales_items_id_fk" FOREIGN KEY ("sales_item_id") REFERENCES "sales_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_item_lots" ADD CONSTRAINT "sales_item_lots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_item_lots" ADD CONSTRAINT "sales_item_lots_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_item_lots" ADD CONSTRAINT "sales_item_lots_reservation_id_stock_lot_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "stock_lot_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_sales_id_sales_id_fk" FOREIGN KEY ("sales_id") REFERENCES "sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_grade_id_item_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "item_grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_items" ADD CONSTRAINT "sales_items_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "uom"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pricing" ADD CONSTRAINT "sales_pricing_sales_item_id_sales_items_id_fk" FOREIGN KEY ("sales_item_id") REFERENCES "sales_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pricing" ADD CONSTRAINT "sales_pricing_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pricing" ADD CONSTRAINT "sales_pricing_lme_record_id_lme_records_id_fk" FOREIGN KEY ("lme_record_id") REFERENCES "lme_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_sales_id_sales_id_fk" FOREIGN KEY ("sales_id") REFERENCES "sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_container_id_containers_id_fk" FOREIGN KEY ("container_id") REFERENCES "containers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_transport_mode_id_transport_modes_id_fk" FOREIGN KEY ("transport_mode_id") REFERENCES "transport_modes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_vessel_id_vessels_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_port_of_loading_id_ports_id_fk" FOREIGN KEY ("port_of_loading_id") REFERENCES "ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_port_of_discharge_id_ports_id_fk" FOREIGN KEY ("port_of_discharge_id") REFERENCES "ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_incoterm_id_incoterms_id_fk" FOREIGN KEY ("incoterm_id") REFERENCES "incoterms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_company_id_sales_number_key" ON "sales" USING btree ("company_id","sales_number") WHERE "sales"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_additional_costs_sales_id_key" ON "sales_additional_costs" USING btree ("sales_id");--> statement-breakpoint
CREATE INDEX "sales_item_lots_sales_item_id_idx" ON "sales_item_lots" USING btree ("sales_item_id");--> statement-breakpoint
CREATE INDEX "sales_item_lots_stock_lot_id_idx" ON "sales_item_lots" USING btree ("stock_lot_id");--> statement-breakpoint
CREATE INDEX "sales_items_sales_id_idx" ON "sales_items" USING btree ("sales_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_pricing_sales_item_id_key" ON "sales_pricing" USING btree ("sales_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_shipments_sales_id_key" ON "sales_shipments" USING btree ("sales_id");