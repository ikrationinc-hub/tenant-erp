import { relations, sql } from "drizzle-orm";
import {
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Deliberately UNQUALIFIED (plain pgTable, no pgSchema binding). The physical
// schema is chosen per-connection at runtime (see get-db.ts) - the same
// table definitions are reused for every tenant_<slug> schema.

export const companyStatusEnum = pgEnum("company_status", ["active", "inactive"]);
export const branchStatusEnum = pgEnum("branch_status", ["active", "inactive"]);

/** created_at/updated_at/created_by/updated_by/deleted_at/version - CLAUDE.md's
 * fixed convention for every table. No FK on created_by/updated_by yet:
 * the tenant `users` table doesn't exist in this minimal schema. */
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

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    countryCode: text("country_code").notNull(),
    currencyCode: text("currency_code").notNull(),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull(),
    timezone: text("timezone").notNull(),
    status: companyStatusEnum("status").notNull().default("active"),
    ...auditColumns(),
  },
  (table) => [
    check(
      "companies_fiscal_year_start_month_check",
      sql`${table.fiscalYearStartMonth} between 1 and 12`,
    ),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    status: branchStatusEnum("status").notNull().default("active"),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("branches_company_id_code_key")
      .on(table.companyId, table.code)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const companiesRelations = relations(companies, ({ many }) => ({
  branches: many(branches),
}));

export const branchesRelations = relations(branches, ({ one }) => ({
  company: one(companies, {
    fields: [branches.companyId],
    references: [companies.id],
  }),
}));
