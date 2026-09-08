import { relations, sql } from "drizzle-orm";
import { boolean, date, index, inet, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * A worker-local MIRROR of the tables the clause-promotion job needs, not
 * the full tenant schema - apps/api isn't set up as an importable workspace
 * package (no exports/main/types pointing at a build output), so rather
 * than reach into another app's src/, the worker keeps just what its own
 * jobs touch. Column shapes must match apps/api/src/database/tenant/
 * schema.ts exactly for the tables listed here (companies, clauses,
 * clause_versions, audit_logs) - keep both in sync if those tables change.
 * Grows as later phases (C-2's document generation, S-6's dashboard
 * refresh, etc.) need more tables mirrored the same way.
 */

function auditColumns() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  };
}

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

export const clauseCategoryEnum = pgEnum("clause_category", ["general_tc", "division_specific"]);
export const clauseVersionStatusEnum = pgEnum("clause_version_status", [
  "draft",
  "approved",
  "active",
  "superseded",
  "expired",
]);

export const clauses = pgTable(
  "clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    branchId: uuid("branch_id"),
    clauseCode: text("clause_code").notNull(),
    clauseTitle: text("clause_title").notNull(),
    divisionId: uuid("division_id"),
    category: clauseCategoryEnum("category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("clauses_company_id_clause_code_key")
      .on(table.companyId, table.clauseCode)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const clauseVersions = pgTable(
  "clause_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    clauseId: uuid("clause_id")
      .notNull()
      .references(() => clauses.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    clauseText: text("clause_text").notNull(),
    status: clauseVersionStatusEnum("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    changeReason: text("change_reason").notNull(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    index("clause_versions_clause_id_idx").on(table.clauseId),
    uniqueIndex("clause_versions_clause_id_version_number_key").on(table.clauseId, table.versionNumber),
    uniqueIndex("clause_versions_one_active_per_clause")
      .on(table.clauseId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const clauseVersionsRelations = relations(clauseVersions, ({ one }) => ({
  clause: one(clauses, {
    fields: [clauseVersions.clauseId],
    references: [clauses.id],
  }),
}));

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").notNull().defaultRandom(),
    companyId: uuid("company_id"),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    requestId: text("request_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [primaryKey({ columns: [table.id, table.changedAt] })],
);

// --- S-6 (docs/SALES-MODULE-PLAN.md): the sales dashboard refresh job's
// own worker-local mirror, same "just what this job touches" discipline
// as the clause-promotion tables above. Column shapes must match apps/
// api/src/database/tenant/schema.ts exactly for every table below - keep
// both in sync if those tables change.

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  countryId: uuid("country_id").notNull(),
});

export const salesStatusEnum = pgEnum("sales_status", ["draft", "approved", "closed", "cancelled"]);

export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  salesDate: date("sales_date").notNull(),
  status: salesStatusEnum("status").notNull().default("draft"),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "restrict" }),
});

export const salesItems = pgTable("sales_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesId: uuid("sales_id")
    .notNull()
    .references(() => sales.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull(),
  itemId: uuid("item_id").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const salesPricing = pgTable("sales_pricing", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesItemId: uuid("sales_item_id")
    .notNull()
    .references(() => salesItems.id, { onDelete: "cascade" }),
  salesAmountUsd: numeric("sales_amount_usd", { precision: 18, scale: 2 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const stockLots = pgTable("stock_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  landedRate: numeric("landed_rate", { precision: 18, scale: 6 }).notNull(),
});

export const salesItemLots = pgTable("sales_item_lots", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesItemId: uuid("sales_item_id")
    .notNull()
    .references(() => salesItems.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull(),
  stockLotId: uuid("stock_lot_id")
    .notNull()
    .references(() => stockLots.id, { onDelete: "restrict" }),
  qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
  reservationId: uuid("reservation_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const stockLotReservations = pgTable("stock_lot_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  qty: numeric("qty", { precision: 18, scale: 6 }).notNull(),
  consumedQty: numeric("consumed_qty", { precision: 18, scale: 6 }).notNull().default("0"),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

export const salesAdditionalCosts = pgTable("sales_additional_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  salesId: uuid("sales_id")
    .notNull()
    .references(() => sales.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull(),
  freight: numeric("freight", { precision: 18, scale: 2 }).notNull().default("0"),
  insurance: numeric("insurance", { precision: 18, scale: 2 }).notNull().default("0"),
  customs: numeric("customs", { precision: 18, scale: 2 }).notNull().default("0"),
  otherCharges: numeric("other_charges", { precision: 18, scale: 2 }).notNull().default("0"),
});

export const salesInvoiceStatusEnum = pgEnum("sales_invoice_status", ["draft", "approved", "reversed", "paid"]);

export const salesInvoices = pgTable("sales_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  salesId: uuid("sales_id")
    .notNull()
    .references(() => sales.id, { onDelete: "restrict" }),
  status: salesInvoiceStatusEnum("status").notNull().default("draft"),
  invoiceAmountUsd: numeric("invoice_amount_usd", { precision: 18, scale: 2 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const salesPaymentAllocations = pgTable("sales_payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => salesInvoices.id, { onDelete: "restrict" }),
  appliedAmountUsd: numeric("applied_amount_usd", { precision: 18, scale: 2 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const contractStatusEnum = pgEnum("contract_status", ["draft", "approved", "signed", "closed"]);

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  status: contractStatusEnum("status").notNull().default("draft"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const purchaseStatusEnum = pgEnum("purchase_status", ["draft", "issued", "closed", "cancelled"]);

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  purchaseDate: date("purchase_date").notNull(),
  status: purchaseStatusEnum("status").notNull().default("draft"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const purchaseItems = pgTable("purchase_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseId: uuid("purchase_id")
    .notNull()
    .references(() => purchases.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const purchasePricing = pgTable("purchase_pricing", {
  id: uuid("id").primaryKey().defaultRandom(),
  purchaseItemId: uuid("purchase_item_id")
    .notNull()
    .references(() => purchaseItems.id, { onDelete: "cascade" }),
  purchaseAmountUsd: numeric("purchase_amount_usd", { precision: 18, scale: 2 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/** The refresh job's own write targets - no auditColumns() (docs/adr/0029: a pure cache/snapshot table, not a business document). */
export const salesDashboardSnapshots = pgTable(
  "sales_dashboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    periodMonth: date("period_month").notNull(),
    totalSalesUsd: numeric("total_sales_usd", { precision: 18, scale: 2 }).notNull(),
    grossProfitUsd: numeric("gross_profit_usd", { precision: 18, scale: 2 }).notNull(),
    netProfitUsd: numeric("net_profit_usd", { precision: 18, scale: 2 }).notNull(),
    outstandingReceivablesUsd: numeric("outstanding_receivables_usd", { precision: 18, scale: 2 }).notNull(),
    shipmentPendingCount: integer("shipment_pending_count").notNull(),
    openContractsCount: integer("open_contracts_count").notNull(),
    completedContractsCount: integer("completed_contracts_count").notNull(),
    totalPurchasesUsd: numeric("total_purchases_usd", { precision: 18, scale: 2 }).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sales_dashboard_snapshots_company_id_period_month_key").on(table.companyId, table.periodMonth)],
);

export const salesDashboardCustomerBreakdown = pgTable(
  "sales_dashboard_customer_breakdown",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    periodMonth: date("period_month").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    salesAmountUsd: numeric("sales_amount_usd", { precision: 18, scale: 2 }).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sales_dashboard_customer_breakdown_key").on(table.companyId, table.periodMonth, table.customerId)],
);

export const salesDashboardItemBreakdown = pgTable(
  "sales_dashboard_item_breakdown",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    periodMonth: date("period_month").notNull(),
    itemId: uuid("item_id").notNull(),
    salesAmountUsd: numeric("sales_amount_usd", { precision: 18, scale: 2 }).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sales_dashboard_item_breakdown_key").on(table.companyId, table.periodMonth, table.itemId)],
);

export const salesDashboardCountryBreakdown = pgTable(
  "sales_dashboard_country_breakdown",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    periodMonth: date("period_month").notNull(),
    countryId: uuid("country_id").notNull(),
    salesAmountUsd: numeric("sales_amount_usd", { precision: 18, scale: 2 }).notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("sales_dashboard_country_breakdown_key").on(table.companyId, table.periodMonth, table.countryId)],
);
