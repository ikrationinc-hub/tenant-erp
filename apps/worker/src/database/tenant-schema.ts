import { relations, sql } from "drizzle-orm";
import { boolean, date, index, inet, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * A worker-local MIRROR of the tables the clause-promotion job needs, not
 * the full tenant schema - apps/api isn't set up as an importable workspace
 * package (no exports/main/types pointing at a build output), so rather
 * than reach into another app's src/, the worker keeps just what its own
 * jobs touch. Column shapes must match apps/api/src/database/tenant/
 * schema.ts exactly for the tables listed here (companies, clauses,
 * clause_versions, audit_logs) - keep both in sync if those tables change.
 * Grows as later phases (C-2's document generation, etc.) need more tables
 * mirrored the same way.
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
