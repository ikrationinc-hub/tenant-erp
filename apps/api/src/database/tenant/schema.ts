import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  inet,
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

export const userStatusEnum = pgEnum("user_status", ["invited", "active", "suspended"]);

/**
 * password_hash is NULLABLE: invited users have no password until they set
 * one themselves via a single-use invite link (that flow is not part of
 * this schema/task - only login against an already-active user is).
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    mobile: text("mobile").notNull(),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    status: userStatusEnum("status").notNull().default("invited"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [uniqueIndex("users_email_key").on(table.email).where(sql`${table.deletedAt} is null`)],
);

/**
 * Deliberately NOT following the generic audit-column convention below
 * (no created_by/updated_by/deleted_at/version): these are system-managed
 * security rows, never user-edited documents. `id` doubles as the refresh
 * JWT's `jti` claim - see core/auth/jwt.ts.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** Stable across an entire rotation lineage - revoking a family revokes every row sharing this id. */
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Null = still valid. Set on rotation (superseded) or explicit revocation (logout, reuse detected). */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Points at the token that superseded this one via rotation, if any. */
    replacedById: uuid("replaced_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("refresh_tokens_family_id_idx").on(table.familyId),
    index("refresh_tokens_user_id_idx").on(table.userId),
  ],
);

/**
 * Append-only security event log - deliberately NOT following the generic
 * audit-column convention (no updated_at/created_by/updated_by/deleted_at/
 * version: a login attempt is never edited or undeleted). user_id and
 * company_id are NULLABLE: an unknown-email attempt resolves neither, but
 * must still be logged (rule 8) - attemptedEmail always records what was
 * typed regardless.
 */
export const loginOutcomeEnum = pgEnum("login_outcome", ["success", "failure"]);

export const loginHistory = pgTable(
  "login_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    attemptedEmail: text("attempted_email").notNull(),
    outcome: loginOutcomeEnum("outcome").notNull(),
    /** Internal-only detail (e.g. "invalid_credentials", "account_suspended") - never sent to the client. */
    reason: text("reason"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("login_history_user_id_idx").on(table.userId),
    index("login_history_attempted_email_idx").on(table.attemptedEmail),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, {
    fields: [users.companyId],
    references: [companies.id],
  }),
  refreshTokens: many(refreshTokens),
  loginHistory: many(loginHistory),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export const loginHistoryRelations = relations(loginHistory, ({ one }) => ({
  user: one(users, {
    fields: [loginHistory.userId],
    references: [users.id],
  }),
}));
