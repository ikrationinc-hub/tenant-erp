ALTER TYPE "stock_movement_type" ADD VALUE 'sale_delivery';--> statement-breakpoint
CREATE TABLE "stock_lot_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"stock_lot_id" uuid NOT NULL,
	"qty" numeric(18, 6) NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"consumed_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_lot_reservations_consumed_within_qty" CHECK ("stock_lot_reservations"."consumed_qty" <= "stock_lot_reservations"."qty")
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"branch_id" uuid,
	"item_id" uuid NOT NULL,
	"grade_id" uuid,
	"warehouse_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"uom_id" uuid NOT NULL,
	"received_qty" numeric(18, 6) NOT NULL,
	"landed_rate" numeric(18, 6) NOT NULL,
	"reserved_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"delivered_qty" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "stock_lots_counters_within_received" CHECK ("stock_lots"."reserved_qty" + "stock_lots"."delivered_qty" <= "stock_lots"."received_qty")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_sign_matches_type";--> statement-breakpoint
ALTER TABLE "stock_lot_reservations" ADD CONSTRAINT "stock_lot_reservations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_reservations" ADD CONSTRAINT "stock_lot_reservations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lot_reservations" ADD CONSTRAINT "stock_lot_reservations_stock_lot_id_stock_lots_id_fk" FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_grade_id_item_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "item_grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_receipt_id_purchase_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_uom_id_uom_id_fk" FOREIGN KEY ("uom_id") REFERENCES "uom"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_lot_reservations_stock_lot_id_idx" ON "stock_lot_reservations" USING btree ("stock_lot_id");--> statement-breakpoint
CREATE INDEX "stock_lot_reservations_reference_idx" ON "stock_lot_reservations" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "stock_lots_company_item_warehouse_idx" ON "stock_lots" USING btree ("company_id","item_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_lots_receipt_id_idx" ON "stock_lots" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_matches_type" CHECK (("stock_movements"."movement_type"::text = 'purchase_receipt' AND "stock_movements"."quantity" > 0) OR ("stock_movements"."movement_type"::text = 'purchase_reversal' AND "stock_movements"."quantity" < 0) OR ("stock_movements"."movement_type"::text = 'sale_delivery' AND "stock_movements"."quantity" < 0));