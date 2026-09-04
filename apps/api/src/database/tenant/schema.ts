import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PgColumnBuilderBase,
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
    // Nullable, not `.notNull()`: countries/currencies are THEMSELVES
    // company-scoped masters (defineMasterTable's company_id FK below), so
    // a brand new company's own row must exist before either master can be
    // seeded for it - core/provisioning/provision-tenant.ts creates the
    // company first, seeds masters second, then backfills these two
    // columns. FE-5.5's Dropdown-via-master-options fields (countryId/
    // currencyId, optionsSource "masters:countries"/"masters:currencies")
    // is the resolved shape - see the ADR-equivalent decision recorded in
    // this task's own conversation: country_id/currency_id FK columns, not
    // scalar ISO codes.
    countryId: uuid("country_id").references((): AnyPgColumn => countries.id, { onDelete: "restrict" }),
    currencyId: uuid("currency_id").references((): AnyPgColumn => currencies.id, { onDelete: "restrict" }),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull(),
    timezone: text("timezone").notNull(),
    taxRegistrationNo: text("tax_registration_no"),
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
 * one themselves via a single-use invite link (core/auth/invite-token.ts,
 * modules/users). email is also NULLABLE: ops staff provisioned through the
 * POST /users/provision exception path (task item 4 of user onboarding)
 * have no email at all and log in by mobile instead - login() tries email
 * first, falls back to mobile if the supplied identifier isn't shaped like
 * one. mobile is NULLABLE for the mirror-image reason: a tenant admin
 * created by core/provisioning/provision-tenant.ts has only an email (the
 * platform admin provisioning them collects a name and email, never a
 * phone number) - a user row genuinely can have either identifier without
 * the other, just not neither. Both carry the same uniqueness requirement
 * (a soft-delete-aware partial unique index each), so whichever identifier
 * IS present can never be ambiguous about which user it means.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    email: text("email"),
    mobile: text("mobile"),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    status: userStatusEnum("status").notNull().default("invited"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email).where(sql`${table.deletedAt} is null`),
    uniqueIndex("users_mobile_key").on(table.mobile).where(sql`${table.deletedAt} is null`),
  ],
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

// --- RBAC ---------------------------------------------------------------
// permission keys are namespaced module.entity.action, e.g.
// "purchase.po.approve", "masters.country.create". `permissions` is a
// shared catalogue (no company_id): the same key means the same thing for
// every company in the tenant. What a company's roles actually grant is
// role_permissions/field_permissions, which ARE company-scoped (via roles).

/** Seeded catalogue, not user-edited day to day - minimal columns, no soft delete/version. */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    module: text("module").notNull(),
    entity: text("entity").notNull(),
    action: text("action").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("permissions_key_key").on(table.key)],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** System roles (e.g. an auto-created company admin) - not this task's concern to seed, just to mark. */
    isSystem: boolean("is_system").notNull().default(false),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("roles_company_id_name_key")
      .on(table.companyId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * Grant records, not user-edited documents: no updated_by/version, but DO
 * soft-delete (deleted_at) - "who revoked what and when" is exactly the
 * segregation-of-duties audit trail the plan doc asks for, and CLAUDE.md's
 * "no hard deletes" rule doesn't carve out an exception for grants.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("role_permissions_role_id_permission_id_key")
      .on(table.roleId, table.permissionId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("user_roles_user_id_role_id_key")
      .on(table.userId, table.roleId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const fieldPermissions = pgTable(
  "field_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    entity: text("entity").notNull(),
    fieldKey: text("field_key").notNull(),
    canView: boolean("can_view").notNull().default(true),
    canEdit: boolean("can_edit").notNull().default(true),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("field_permissions_role_module_entity_field_key")
      .on(table.companyId, table.roleId, table.module, table.entity, table.fieldKey)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const rolesRelations = relations(roles, ({ one, many }) => ({
  company: one(companies, {
    fields: [roles.companyId],
    references: [companies.id],
  }),
  rolePermissions: many(rolePermissions),
  userRoles: many(userRoles),
  fieldPermissions: many(fieldPermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const fieldPermissionsRelations = relations(fieldPermissions, ({ one }) => ({
  role: one(roles, {
    fields: [fieldPermissions.roleId],
    references: [roles.id],
  }),
  company: one(companies, {
    fields: [fieldPermissions.companyId],
    references: [companies.id],
  }),
}));

// --- User onboarding ------------------------------------------------------

export const invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);

/**
 * Single-use, email-delivered invite tokens (admins never set passwords -
 * see docs/adr/0006-user-onboarding.md). Only `token_hash` is ever stored;
 * the raw token exists only in the email and the invitee's URL, exactly
 * like a password - a DB read alone must never be enough to redeem an
 * invitation. `roles` is the intent captured at invite time; the actual
 * user_roles rows are only inserted once the invitation is accepted.
 *
 * Not on the generic auditColumns() convention: an invitation is a
 * short-lived, three-state workflow object (pending -> accepted | revoked),
 * not a versioned business document - "expired" is deliberately NOT a
 * fourth persisted status (nothing proactively transitions it), it's
 * computed at read time by comparing expires_at to now().
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    roles: jsonb("roles").$type<string[]>().notNull().default([]),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    status: invitationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_key").on(table.tokenHash),
    uniqueIndex("invitations_company_id_email_pending_key")
      .on(table.companyId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  company: one(companies, {
    fields: [invitations.companyId],
    references: [companies.id],
  }),
  invitedByUser: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

/**
 * Append-only and, as of the partitioning/immutability hardening task,
 * enforced as such at the DB level - not just by convention: a migration
 * REVOKEs UPDATE/DELETE on this table from hyperion_app (the role every
 * normal query runs as; see get-db.ts and migration-runner.ts's
 * ensureAppRoleGrants), so no repository code, however buggy, can ever
 * mutate a written row. No updated_at/deleted_at/version for the same
 * reason login_history/permissions omit them - there is nothing to version,
 * an audit entry is never edited.
 *
 * `company_id`/`changed_by` are nullable, mirroring login_history's own
 * precedent: a login attempt against an unknown email resolves neither a
 * user nor that user's company, but the attempt itself still needs a
 * home. (An attempt where the tenant itself can't even be resolved has
 * nowhere to be written at all - there is no schema to write into - so
 * that case is logged only via logger.warn, same as before this task.)
 *
 * PARTITION BY RANGE (changed_at), monthly, from the very first migration
 * that creates this table (migrations/0006_sad_trish_tilby.sql, which also
 * creates a DEFAULT partition as a catch-all) - this is expected to become
 * the largest table in the system, and partitioning it after the fact,
 * once it's large, is exactly the kind of operation you do NOT want to be
 * doing under pressure. Specific monthly partitions are created and kept
 * topped up by migration-runner.ts's ensureAuditLogPartitions, via the
 * admin connection (see core/audit/write.ts's doc comment for why this
 * can't run through the app's normal restricted connection). drizzle-kit's
 * schema DSL can't express PARTITION BY, so the actual CREATE TABLE lives
 * in a hand-written migration; this pgTable definition exists for query-
 * building/type-safety against the partitioned parent, which behaves like
 * a normal table for every DML statement the app issues.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").notNull().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    /** The partition key - every partition-scoped statement filters/creates on this. */
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    /** text, not uuid: requestId can be client-supplied via the X-Request-Id header (request-context.middleware.ts), never validated as UUID-shaped. */
    requestId: text("request_id"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.changedAt] }),
    index("audit_logs_entity_entity_id_idx").on(table.entity, table.entityId),
    index("audit_logs_changed_by_idx").on(table.changedBy),
  ],
);

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  company: one(companies, {
    fields: [auditLogs.companyId],
    references: [companies.id],
  }),
  changedByUser: one(users, {
    fields: [auditLogs.changedBy],
    references: [users.id],
  }),
}));

// --- Numbering engine (CLAUDE.md rule 7) ---------------------------------
// Gapless document numbers via a locked counter row, never a Postgres
// SEQUENCE (a rolled-back transaction leaks the value a SEQUENCE handed
// out - see core/numbering/next-number.ts). One row per
// (company, branch, doc_type, fiscal_year); a new fiscal year gets its own
// row rather than resetting current_value in place, so last year's final
// number stays exactly what was printed on last year's last document even
// if this row is inspected later.

/**
 * `.nullsNotDistinct()` (Postgres 15+) matters here specifically because
 * branch_id is nullable (a company-level series, e.g. no branch
 * segmentation): the default Postgres behavior treats every NULL as
 * distinct from every other NULL, so a plain unique constraint would let
 * two concurrent first-ever inserts for the same (company, NULL, doc_type,
 * fiscal_year) both succeed - exactly the race SELECT ... FOR UPDATE is
 * supposed to make impossible. Without this, the uniqueness guarantee
 * silently doesn't apply to the no-branch case.
 */
export const numberSeries = pgTable(
  "number_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    docType: text("doc_type").notNull(),
    /** e.g. "PO-{BRANCH}-{FY}-{0000}" - see core/numbering/next-number.ts for token semantics. */
    prefixPattern: text("prefix_pattern").notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    /** Last number actually issued. The next call issues currentValue + 1. */
    currentValue: integer("current_value").notNull().default(0),
    /** Authoritative zero-pad width for the sequence portion - not derived from counting zeros in prefix_pattern's token. */
    padding: integer("padding").notNull(),
    ...auditColumns(),
  },
  (table) => [
    unique("number_series_company_branch_doctype_fy_key")
      .on(table.companyId, table.branchId, table.docType, table.fiscalYear)
      .nullsNotDistinct(),
  ],
);

export const numberSeriesRelations = relations(numberSeries, ({ one }) => ({
  company: one(companies, {
    fields: [numberSeries.companyId],
    references: [companies.id],
  }),
  branch: one(branches, {
    fields: [numberSeries.branchId],
    references: [branches.id],
  }),
}));

// --- Menu engine ----------------------------------------------------------
// A menu item's visibility (core/menu-engine/resolve.ts) is the AND of
// three independent gates: required_permission (null = no permission
// required), module_key (null = not tied to a toggleable module), and
// is_visible (an explicit admin-controlled on/off switch independent of
// the other two). `required_permission`/`module_key` are plain text, not
// FK-constrained to permissions.key/a modules table - modules are defined
// in code (core/module-registry), not a DB table, and a menu referencing
// a permission key that doesn't exist yet (mid-setup) should not be a
// hard FK violation.

export const menus = pgTable(
  "menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    path: text("path"),
    icon: text("icon"),
    parentId: uuid("parent_id").references((): AnyPgColumn => menus.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    requiredPermission: text("required_permission"),
    moduleKey: text("module_key"),
    isVisible: boolean("is_visible").notNull().default(true),
    // Navigation shell only ("operate" main sidebar vs "settings" area) -
    // not a permission gate. See packages/contracts/src/menus.ts.
    section: text("section").notNull().default("operate"),
    // Settings launcher grouping only - which heading/card this node's
    // link appears under on the launcher page. Null for every "operate"
    // node. Never gates visibility or affects the settings sub-nav tree.
    launcherSection: text("launcher_section"),
    launcherGroup: text("launcher_group"),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("menus_company_id_key_key")
      .on(table.companyId, table.key)
      .where(sql`${table.deletedAt} is null`),
    index("menus_parent_id_idx").on(table.parentId),
  ],
);

export const menusRelations = relations(menus, ({ one, many }) => ({
  company: one(companies, {
    fields: [menus.companyId],
    references: [companies.id],
  }),
  parent: one(menus, {
    fields: [menus.parentId],
    references: [menus.id],
    relationName: "menu_parent",
  }),
  children: many(menus, { relationName: "menu_parent" }),
}));

// --- Generic master-data pattern (docs/spec/Purchase-V2.md §4) ------------
// Every "Dropdown -> Master" field in the Purchase spec needs a master
// table. `defineMasterTable` is the schema half of that generic pattern
// (core/masters/ is the repository/service/controller/routes half) -
// company-scoped (not tenant-wide like the old reference_masters precursor
// this replaces: CLAUDE.md's table conventions apply to master data too,
// no exception carved out for it), soft-delete-aware unique on
// (company_id, code), and a fixed column set every master shares
// (code/name/is_active/sort_order) plus whatever extra typed columns that
// specific master needs (e.g. cities' country_id FK). branch_id exists for
// convention-compliance (every table has one) but nothing in core/masters
// reads or writes it yet - master data is company-wide, not branch-scoped,
// in this build.

/** items' vertical seam (task: "item_type column now even though only metals is used") - not a registry yet, just the column. */
export const itemTypeEnum = pgEnum("item_type", ["metals", "electronics", "toys"]);

function defineMasterTable<TExtra extends Record<string, PgColumnBuilderBase>>(
  tableName: string,
  extraColumns: TExtra,
) {
  return pgTable(
    tableName,
    {
      id: uuid("id").primaryKey().defaultRandom(),
      companyId: uuid("company_id")
        .notNull()
        .references(() => companies.id, { onDelete: "restrict" }),
      branchId: uuid("branch_id"),
      code: text("code").notNull(),
      name: text("name").notNull(),
      isActive: boolean("is_active").notNull().default(true),
      sortOrder: integer("sort_order").notNull().default(0),
      ...extraColumns,
      ...auditColumns(),
    },
    (table) => [
      uniqueIndex(`${tableName}_company_id_code_key`)
        .on(table.companyId, table.code)
        .where(sql`${table.deletedAt} is null`),
    ],
  );
}

export const countries = defineMasterTable("countries", {});
export const currencies = defineMasterTable("currencies", {});
export const paymentTerms = defineMasterTable("payment_terms", {});
export const uom = defineMasterTable("uom", {});
export const ports = defineMasterTable("ports", {});
export const warehouses = defineMasterTable("warehouses", {});
export const incoterms = defineMasterTable("incoterms", {});
export const itemGrades = defineMasterTable("item_grades", {});
export const vessels = defineMasterTable("vessels", {});
export const transportModes = defineMasterTable("transport_modes", {});
export const lmeExchanges = defineMasterTable("lme_exchanges", {});
export const hedgePlatforms = defineMasterTable("hedge_platforms", {});
export const supplierTypes = defineMasterTable("supplier_types", {});
/** Prompt 21 item 1: the purchase-scoping master (Container/Electronics/Scrap/Bulk, seeded by core/masters/seed-data.ts) - the seam for the future vertical model. Deliberately no vertical-specific behavior yet (task's own instruction) - just a scoping FK on purchases. */
export const divisions = defineMasterTable("divisions", {});
/** Prompt 21 item 5: was free text on purchase_shipments.container_number - promoted to a master so a container is a real, reusable reference instead of a string a user could misspell across shipments. `containerType` is optional (the task's "optional type/size"), never required. */
export const containers = defineMasterTable("containers", {
  containerType: text("container_type"),
});
/**
 * Stub only (docs/spec/Purchase-V2.md §4: "customers *(stub only - Reserved
 * Customer needs the dropdown)*", and manifests.ts's "masters" entry: "customer
 * remains a stub - not built yet, declared ahead of its own future module").
 * The table exists now purely so purchase_allocations.reserved_customer_id
 * has something real to FK into; no CRUD/masters-registry entry for it
 * yet - that's the dedicated future Customer module (likely alongside
 * Sales), not this session.
 */
export const customers = defineMasterTable("customers", {});

/** The one master with a required FK to another master (task: "cities (fk country)") - the cascading-dropdown reference case. */
export const cities = defineMasterTable("cities", {
  countryId: uuid("country_id")
    .notNull()
    .references(() => countries.id, { onDelete: "restrict" }),
});

export const items = defineMasterTable("items", {
  itemType: itemTypeEnum("item_type").notNull(),
});

export const countriesRelations = relations(countries, ({ many }) => ({
  cities: many(cities),
}));

export const citiesRelations = relations(cities, ({ one }) => ({
  country: one(countries, {
    fields: [cities.countryId],
    references: [countries.id],
  }),
}));

// --- Field engine, Tier 2 ONLY (CLAUDE.md field model) ---------------------
// A field_definitions ROW is itself the override: label/is_visible/
// is_mandatory/sort_order all have real (non-null) values, because
// existence of the row means "override this field," not "maybe override
// some of these." core/provisioning/seed-field-definitions.ts materializes
// one row per code-declared field (core/field-engine/defaults.ts) for
// every company at provisioning time - so a PATCH always has a real row/id
// to target, and core/field-engine/resolve.ts's "merge code defaults with
// company overrides" only needs to fall back to the code default for a
// field added to the registry after a tenant was last provisioned.
//
// `tier` is CHECKed to exactly 2 - this table only ever holds Tier 2
// overrides. Tier 1 fields need no row (they're just plain typed columns);
// Tier 3 (arbitrary user-defined custom_fields/JSONB) is explicitly out of
// this system's 90-day scope (CLAUDE.md's field model) and this table
// makes no attempt to support it.
//
// `data_type` is never patchable (enforced by core/field-engine's PATCH
// validator never accepting it, not by a DB trigger) - CLAUDE.md rule:
// "data_type is NEVER overridable." `field_key` is likewise immutable and
// never patchable: it's the real column/property identifier queries and
// calculations depend on, and a label change must never be able to touch
// it (rule: "Changing a label must not affect the column name, any query,
// or any calculation").
export const fieldDataTypeEnum = pgEnum("field_data_type", [
  "text",
  "textarea",
  "number",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "select",
]);

export interface FieldValidationRules {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
}

export const fieldDefinitions = pgTable(
  "field_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    module: text("module").notNull(),
    entity: text("entity").notNull(),
    fieldKey: text("field_key").notNull(),
    tier: integer("tier").notNull().default(2),
    label: text("label").notNull(),
    dataType: fieldDataTypeEnum("data_type").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    isMandatory: boolean("is_mandatory").notNull().default(false),
    isEditable: boolean("is_editable").notNull().default(true),
    defaultValue: text("default_value"),
    /** e.g. "reference_master:currency" - where a select field's options come from. Opaque to the DB; core/field-engine and the frontend agree on the format. */
    optionsSource: text("options_source"),
    validationJson: jsonb("validation_json").$type<FieldValidationRules>(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** System fields cannot be hidden or made optional (core/field-engine/mutations.ts enforces this on every PATCH) - e.g. a login identifier. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Lookup only, ignored otherwise - lets this field's "+ Add" quick-create the referenced record inline (core/schema-form/field-types/LookupField.tsx). Company-overridable, same tier as label/isVisible/isMandatory - not structural like dataType. */
    allowCreate: boolean("allow_create").notNull().default(false),
    /**
     * C-3a (docs/CONTRACT-MODULE-BUILD.md): nullable = applies to ALL
     * divisions, same optional-FK convention as purchases.divisionId
     * (schema.ts). A specific division's override (e.g. Scrap's own
     * "materialType" label) coexists with a NULL-division row for the
     * same fieldKey - resolve.ts's merge logic picks the division-specific
     * row when both exist, never the DB. Two PARTIAL unique indexes below
     * (not one plain 5-column index) are what actually prevent duplicates:
     * Postgres unique indexes treat every NULL as distinct from every
     * other NULL, so a single index including a nullable division_id
     * would silently allow the SAME fieldKey to be inserted twice with
     * division_id NULL - exactly the ambiguous "all divisions" collision
     * this column exists to prevent.
     */
    divisionId: uuid("division_id").references(() => divisions.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("field_definitions_company_module_entity_field_key_division")
      .on(table.companyId, table.module, table.entity, table.fieldKey, table.divisionId)
      .where(sql`${table.deletedAt} is null and ${table.divisionId} is not null`),
    uniqueIndex("field_definitions_company_module_entity_field_key_all_divisions")
      .on(table.companyId, table.module, table.entity, table.fieldKey)
      .where(sql`${table.deletedAt} is null and ${table.divisionId} is null`),
    check("field_definitions_tier_check", sql`${table.tier} = 2`),
  ],
);

export const fieldDefinitionsRelations = relations(fieldDefinitions, ({ one }) => ({
  company: one(companies, {
    fields: [fieldDefinitions.companyId],
    references: [companies.id],
  }),
}));

// --- Storage / attachments -------------------------------------------------
// Entity-agnostic, like audit_logs: `entity` + `entity_id` (+ `field_key`,
// since one entity can have several distinct upload slots - e.g. a
// purchase's Invoice vs Bill of Lading) rather than a table per attaching
// module. A row only ever exists for a file that has ALREADY passed
// ClamAV (core/storage/upload.ts scans before it uploads to S3 or inserts
// this row - "ClamAV scan before the file is accepted") - there is no
// "pending scan" state to model, so `scanned_at` is NOT NULL. No hard
// deletes (rule 8): removing an attachment is a future concern this task
// doesn't ask for; only upload + presigned download exist today.
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    fieldKey: text("field_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    /** Bytes. bigint/mode:"number" (safe to 2^53) - not a `numeric` money column, rule 1's ban on mode:"number" doesn't apply to a byte count. */
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    /** SHA-256, hex-encoded, computed while streaming to the temp spool file (never buffered in memory as a whole). */
    checksum: text("checksum").notNull(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull(),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("attachments_storage_key_key").on(table.storageKey),
    index("attachments_company_entity_entity_id_idx").on(table.companyId, table.entity, table.entityId),
  ],
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  company: one(companies, {
    fields: [attachments.companyId],
    references: [companies.id],
  }),
}));

// --- Supplier master (docs/spec/Purchase-V2.md §1, Sub Tab 1) -------------
// Exactly the spec's field list, split across three tables per this task's
// instruction: `suppliers` (the header-level fields), `supplier_contacts`
// and `supplier_banks` (the spec's single Contact Person/Mobile/Email and
// Bank Details fields, made repeatable - zero-to-many rows, matching their
// "No" mandatory in the spec exactly: zero rows is valid). No sub-fields
// invented beyond what the spec names (no bank_name/account_number/ifsc -
// the spec has exactly one "Bank Details" text field). `status` follows
// the same active/inactive enum convention as companies/branches, not
// core/masters' `is_active` boolean - a supplier is a first-class business
// entity like a branch, not a generic code/name master.
export const supplierStatusEnum = pgEnum("supplier_status", ["active", "inactive"]);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    /** FR-002: auto-generated via core/numbering/next-number.ts, never app-assigned. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** "Local/International... Configurable" (spec Remarks) - a real master, not a hardcoded enum. */
    supplierTypeId: uuid("supplier_type_id")
      .notNull()
      .references(() => supplierTypes.id, { onDelete: "restrict" }),
    countryId: uuid("country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "restrict" }),
    /** "Based on Country" (spec Remarks) - the cascading-dropdown case, same as masters' cities->countries. */
    cityId: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    address: text("address"),
    taxRegistrationNo: text("tax_registration_no"),
    paymentTermId: uuid("payment_term_id")
      .notNull()
      .references(() => paymentTerms.id, { onDelete: "restrict" }),
    currencyId: uuid("currency_id")
      .notNull()
      .references(() => currencies.id, { onDelete: "restrict" }),
    status: supplierStatusEnum("status").notNull().default("active"),
    remarks: text("remarks"),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("suppliers_company_id_code_key")
      .on(table.companyId, table.code)
      .where(sql`${table.deletedAt} is null`),
    // FR-005: no duplicate names, soft-delete-aware - a deactivated/deleted
    // supplier's name becomes reusable, never permanently reserved.
    uniqueIndex("suppliers_company_id_name_key")
      .on(table.companyId, table.name)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const supplierContacts = pgTable(
  "supplier_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    contactPerson: text("contact_person").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    ...auditColumns(),
  },
  (table) => [index("supplier_contacts_supplier_id_idx").on(table.supplierId)],
);

export const supplierBanks = pgTable(
  "supplier_banks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** The spec's one "Bank Details" text-area field, verbatim - no invented sub-fields (account number, IFSC, ...). */
    details: text("details").notNull(),
    ...auditColumns(),
  },
  (table) => [index("supplier_banks_supplier_id_idx").on(table.supplierId)],
);

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  company: one(companies, {
    fields: [suppliers.companyId],
    references: [companies.id],
  }),
  supplierType: one(supplierTypes, {
    fields: [suppliers.supplierTypeId],
    references: [supplierTypes.id],
  }),
  country: one(countries, {
    fields: [suppliers.countryId],
    references: [countries.id],
  }),
  city: one(cities, {
    fields: [suppliers.cityId],
    references: [cities.id],
  }),
  paymentTerm: one(paymentTerms, {
    fields: [suppliers.paymentTermId],
    references: [paymentTerms.id],
  }),
  currency: one(currencies, {
    fields: [suppliers.currencyId],
    references: [currencies.id],
  }),
  contacts: many(supplierContacts),
  banks: many(supplierBanks),
}));

export const supplierContactsRelations = relations(supplierContacts, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierContacts.supplierId],
    references: [suppliers.id],
  }),
}));

export const supplierBanksRelations = relations(supplierBanks, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierBanks.supplierId],
    references: [suppliers.id],
  }),
}));

// --- Broker / "D" party (Prompt 21 item 4) ------------------------------
// Mirrors the supplier module's own shape (its own table + contacts + banks
// child tables, own repository/service/controller/routes, own permission
// namespace) - deliberately NOT a generic core/masters/factory.ts master,
// same reasoning suppliers itself isn't one: a broker needs contacts/banks
// sub-tables a defineMasterModule call has no room for. Narrower than
// supplier's own field set on purpose - no supplierTypeId/countryId/
// cityId/paymentTermId/currencyId equivalents, since a broker is a
// commission-earning intermediary, not a trading counterparty with its own
// payment terms/currency (the task's own wording: "name, code, contact
// fields (mirror the supplier master shape), status, audit columns").
export const brokerStatusEnum = pgEnum("broker_status", ["active", "inactive"]);

export const brokers = pgTable(
  "brokers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: brokerStatusEnum("status").notNull().default("active"),
    remarks: text("remarks"),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("brokers_company_id_name_key").on(table.companyId, table.name).where(sql`${table.deletedAt} is null`),
    uniqueIndex("brokers_company_id_code_key").on(table.companyId, table.code).where(sql`${table.deletedAt} is null`),
  ],
);

export const brokerContacts = pgTable(
  "broker_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brokerId: uuid("broker_id")
      .notNull()
      .references(() => brokers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    contactPerson: text("contact_person").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    ...auditColumns(),
  },
  (table) => [index("broker_contacts_broker_id_idx").on(table.brokerId)],
);

export const brokerBanks = pgTable(
  "broker_banks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brokerId: uuid("broker_id")
      .notNull()
      .references(() => brokers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    details: text("details").notNull(),
    ...auditColumns(),
  },
  (table) => [index("broker_banks_broker_id_idx").on(table.brokerId)],
);

export const brokersRelations = relations(brokers, ({ one, many }) => ({
  company: one(companies, {
    fields: [brokers.companyId],
    references: [companies.id],
  }),
  contacts: many(brokerContacts),
  banks: many(brokerBanks),
}));

export const brokerContactsRelations = relations(brokerContacts, ({ one }) => ({
  broker: one(brokers, {
    fields: [brokerContacts.brokerId],
    references: [brokers.id],
  }),
}));

export const brokerBanksRelations = relations(brokerBanks, ({ one }) => ({
  broker: one(brokers, {
    fields: [brokerBanks.brokerId],
    references: [brokers.id],
  }),
}));

// --- Purchase: header + shipment (docs/spec/Purchase-V2.md Sub Tab 2, A-C) -
// Session (a) of the Purchase build ("the big one" - split across
// sessions per that task's instruction). Items/pricing/allocation/costs/
// attachments (D-H) and LME/hedging/workflow/stock (Sub Tab 3, FR-107/108)
// are later sessions - NOT built here. `status` exists as a column now
// (the spec's Purchase Header table requires it) but nothing in this
// session ever moves it off "draft" - the actual Draft->Approved->Posted
// transitions, their permissions, and Posted immutability (CLAUDE.md rule
// 8) are the workflow engine, explicitly deferred to session (e).
//
// PL-3 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0018): reworked to
// Draft -> Issued -> Closed/Cancelled, per ADR 0016/0017's own scoping.
// "Issued" replaces "Approved" (commitment sent to supplier); "Posted" is
// DROPPED entirely - its only real effect (rule 8 immutability) is now
// carried by the two terminal states instead of a separate manual step.
// "Closed" is a DERIVED, automatic transition (never a user-invoked
// endpoint) - fires the moment receivedStatus="fully_received" AND
// billedStatus="fully_billed" are both true, checked in the same
// transaction as whatever confirmed a receipt or approved a bill last
// (purchase-receipts.service.ts's confirm, purchase-bills.service.ts's
// approve). "Cancelled" is new: a PO the buyer called off before
// fulfilment - manually invoked, guarded so it can never fire once
// anything's been received or billed against the PO (see
// requireNothingFulfilledForCancel in purchase.service.ts).
export const purchaseStatusEnum = pgEnum("purchase_status", ["draft", "issued", "closed", "cancelled"]);
/** Prompt 21 item 2: drives which section is active - 'fixed' keeps today's manual item rate and hides LME Records; 'lme' shows LME Records and derives the item rate from the LME final rate (purchase-items.service.ts). */
export const purchasePricingTypeEnum = pgEnum("purchase_pricing_type", ["lme", "fixed"]);
/** Prompt 21 item 4: unused today (a single broker_commission amount is all the form captures) - added now, nullable, so a %/flat split can be introduced later without a migration. Nothing reads or writes this column yet. */
export const brokerCommissionTypeEnum = pgEnum("broker_commission_type", ["percentage", "flat"]);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** FR-101: auto-generated via core/numbering/next-number.ts (docType "PO", already seeded by core/provisioning/seed-number-series.ts), never app-assigned. */
    purchaseNumber: text("purchase_number").notNull(),
    purchaseDate: date("purchase_date").notNull(),
    status: purchaseStatusEnum("status").notNull().default("draft"),
    /**
     * Prompt 21 item 1: the purchase-scoping master, selected first on the
     * form. NULLABLE at the DB level on purpose, unlike branchId/buyerId/
     * supplierId - required going forward via createPurchaseSchema for
     * every NEW purchase, but existing purchases (real data already on
     * the droplet) are deliberately left with no division rather than
     * backfilled to a guessed one (explicit decision: "leave them").
     */
    divisionId: uuid("division_id").references(() => divisions.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** Client correction: "Buyer" names which of the tenant's own legal entities (companies) is the buyer of record - NOT the user who negotiated it (originally spec table A's "Buyer | Dropdown | User", superseded). Distinct from companyId above: companyId is the purchase's own scope/branch owner; buyerId can name a different affiliated company for intercompany purchasing. */
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** FR-102: from Supplier Master, never free text. */
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    supplierReferenceNo: text("supplier_reference_no"),
    /** Prompt 21 item 2 - same "leave existing rows unset, require going forward" treatment as divisionId, for the same reason (no sensible value to backfill existing purchases to). */
    pricingType: purchasePricingTypeEnum("pricing_type"),
    /** Prompt 21 item 4: nullable - "not every deal has a broker". */
    brokerId: uuid("broker_id").references(() => brokers.id, { onDelete: "restrict" }),
    /** Money (rule 1): numeric, decimal.js at the repository boundary, never a float. Nullable - only meaningful when brokerId is set. */
    brokerCommission: numeric("broker_commission", { precision: 18, scale: 2 }),
    brokerCommissionType: brokerCommissionTypeEnum("broker_commission_type"),
    /** Sub Tab 2's "Standard fields - every record": "Approved By · Approved Date" in the spec's original naming - renamed in PL-3 (column rename, same "rename in place, keep history" discipline as PL-2's invoice_number -> bill_number) since "Approved" no longer exists as a status; this is now the Draft->Issued transition's actor/timestamp. Set once, by purchase.service.ts's issue() transition; never touched again. */
    issuedBy: uuid("issued_by").references(() => users.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    /** PL-3: the Cancelled transition's actor/timestamp - nullable, set only on Draft/Issued -> Cancelled. No "closedBy" column: Closed is a derived, automatic transition with no human actor (see purchaseStatusEnum's doc comment) - its timestamp still lives in audit_logs like every other system-driven change. */
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "restrict" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("purchases_company_id_purchase_number_key")
      .on(table.companyId, table.purchaseNumber)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * 1:1 with `purchases` (spec's Shipment Details, table C, is a single block
 * of fields for one purchase transaction - nothing in the spec suggests a
 * purchase ever has more than one shipment). `shipment_year` is
 * server-derived from `loading_date`'s calendar year (resolved open
 * question #7) - never a user-entered value, so there's no drift to
 * validate against. `through`/`vessel` are real masters
 * (transport_modes/vessels), not hardcoded enums, matching the "Masters
 * required by this module" list - the same resolution already applied to
 * suppliers.supplierTypeId.
 */
export const purchaseShipments = pgTable(
  "purchase_shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    shipmentYear: integer("shipment_year").notNull(),
    lotNumber: text("lot_number").notNull(),
    /** Prompt 21 item 5: was free text (container_number) - promoted to a lookup against the containers master. 0025's migration backfills every distinct existing container_number into the containers master and links it here before adding this NOT NULL, so no data is lost. */
    containerId: uuid("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "restrict" }),
    blNo: text("bl_no").notNull(),
    loadingDate: date("loading_date").notNull(),
    transportModeId: uuid("transport_mode_id")
      .notNull()
      .references(() => transportModes.id, { onDelete: "restrict" }),
    vesselId: uuid("vessel_id").references(() => vessels.id, { onDelete: "restrict" }),
    voyageNumber: text("voyage_number"),
    portOfLoadingId: uuid("port_of_loading_id")
      .notNull()
      .references(() => ports.id, { onDelete: "restrict" }),
    portOfDischargeId: uuid("port_of_discharge_id")
      .notNull()
      .references(() => ports.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    incotermId: uuid("incoterm_id")
      .notNull()
      .references(() => incoterms.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (table) => [uniqueIndex("purchase_shipments_purchase_id_key").on(table.purchaseId)],
);

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  company: one(companies, {
    fields: [purchases.companyId],
    references: [companies.id],
  }),
  branch: one(branches, {
    fields: [purchases.branchId],
    references: [branches.id],
  }),
  buyer: one(companies, {
    fields: [purchases.buyerId],
    references: [companies.id],
  }),
  supplier: one(suppliers, {
    fields: [purchases.supplierId],
    references: [suppliers.id],
  }),
  division: one(divisions, {
    fields: [purchases.divisionId],
    references: [divisions.id],
  }),
  broker: one(brokers, {
    fields: [purchases.brokerId],
    references: [brokers.id],
  }),
  shipment: one(purchaseShipments, {
    fields: [purchases.id],
    references: [purchaseShipments.purchaseId],
  }),
  bills: many(purchaseBills),
  receipts: many(purchaseReceipts),
}));

export const purchaseShipmentsRelations = relations(purchaseShipments, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseShipments.purchaseId],
    references: [purchases.id],
  }),
  container: one(containers, {
    fields: [purchaseShipments.containerId],
    references: [containers.id],
  }),
  transportMode: one(transportModes, {
    fields: [purchaseShipments.transportModeId],
    references: [transportModes.id],
  }),
  vessel: one(vessels, {
    fields: [purchaseShipments.vesselId],
    references: [vessels.id],
  }),
  portOfLoading: one(ports, {
    fields: [purchaseShipments.portOfLoadingId],
    references: [ports.id],
  }),
  portOfDischarge: one(ports, {
    fields: [purchaseShipments.portOfDischargeId],
    references: [ports.id],
  }),
  warehouse: one(warehouses, {
    fields: [purchaseShipments.warehouseId],
    references: [warehouses.id],
  }),
  incoterm: one(incoterms, {
    fields: [purchaseShipments.incotermId],
    references: [incoterms.id],
  }),
}));

// --- Purchase: items + pricing (docs/spec/Purchase-V2.md Sub Tab 2, D-E) ---
// Session (b) of the Purchase build. Resolved open questions #1/#2: an item
// is one-of-many per purchase (FR-104 explicitly says "one or multiple"),
// and Pricing attaches PER ITEM, 1:1 - `purchase_amount_usd = quantity x
// purchase_rate_usd` (FR-105) only means something against one item's own
// quantity, not a purchase-wide total. `purchase_pricing` is its own table
// (not columns on `purchase_items`) purely to mirror the TABLES list given
// for this task - the 1:1 relationship is the same either way.
//
// Money columns (rule 1): amounts `numeric(18,2)`, rates/quantities
// `numeric(18,6)`. Never `mode: "number"` - every one of these stays a
// plain string in JS/TS, parsed to `Decimal` only at the repository
// boundary (common/money/decimal.ts, docs/adr/0012-money-rounding.md).
export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    gradeId: uuid("grade_id").references(() => itemGrades.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    uomId: uuid("uom_id")
      .notNull()
      .references(() => uom.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (table) => [index("purchase_items_purchase_id_idx").on(table.purchaseId)],
);

/**
 * 1:1 with `purchase_items` (resolved open question #2: pricing per item).
 * `purchase_amount_usd`/`purchase_amount_aed` are FR-105/FR-106's
 * server-CALCULATED fields - never accepted from a client, always derived
 * in purchase-items.service.ts from this row's own `quantity` x
 * `purchase_rate_usd` x `exchange_rate`, each column rounded independently
 * from the same full-precision chain (ADR 0012 - never a rounded column
 * feeding the next column's calculation).
 */
export const purchasePricing = pgTable(
  "purchase_pricing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseItemId: uuid("purchase_item_id")
      .notNull()
      .references(() => purchaseItems.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    purchaseRateUsd: numeric("purchase_rate_usd", { precision: 18, scale: 6 }).notNull(),
    purchaseAmountUsd: numeric("purchase_amount_usd", { precision: 18, scale: 2 }).notNull(),
    exchangeRate: numeric("exchange_rate", { precision: 18, scale: 6 }).notNull(),
    purchaseAmountAed: numeric("purchase_amount_aed", { precision: 18, scale: 2 }).notNull(),
    /**
     * Which lme_record (if any) this item's rate was derived from -
     * stamped once at item-creation time under pricing_type='lme', never
     * updated afterward (purchase-items.service.ts's updatePurchaseItem
     * never re-derives the rate from a possibly-different "latest"
     * record - it keeps whatever rate the item already had). Null under
     * pricing_type='fixed'. This is what lets purchase-lme.service.ts
     * tell an lme_record is "used" and must lock (rule 8's spirit:
     * corrections are reversal + re-entry, never editing consumed data).
     */
    lmeRecordId: uuid("lme_record_id").references(() => lmeRecords.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (table) => [uniqueIndex("purchase_pricing_purchase_item_id_key").on(table.purchaseItemId)],
);

export const purchaseItemsRelations = relations(purchaseItems, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  item: one(items, {
    fields: [purchaseItems.itemId],
    references: [items.id],
  }),
  grade: one(itemGrades, {
    fields: [purchaseItems.gradeId],
    references: [itemGrades.id],
  }),
  uom: one(uom, {
    fields: [purchaseItems.uomId],
    references: [uom.id],
  }),
  pricing: one(purchasePricing, {
    fields: [purchaseItems.id],
    references: [purchasePricing.purchaseItemId],
  }),
}));

export const purchasePricingRelations = relations(purchasePricing, ({ one }) => ({
  purchaseItem: one(purchaseItems, {
    fields: [purchasePricing.purchaseItemId],
    references: [purchaseItems.id],
  }),
  lmeRecord: one(lmeRecords, {
    fields: [purchasePricing.lmeRecordId],
    references: [lmeRecords.id],
  }),
}));

// --- Purchase: allocation + additional costs (docs/spec/Purchase-V2.md Sub
// Tab 2, F-G) ------------------------------------------------------------
// Session (c) of the Purchase build. Resolved open questions #3/#4:
// Reserved Customer is many-per-purchase (a split allocation list -
// `allocation_pct` only means something if there's something to split
// against), Additional Costs is a flat one-row-per-purchase total with NO
// per-item/lot distribution - no FR asks for a landed-cost engine, and the
// TABLES list for this task names no purchase_item_id on
// purchase_additional_costs.
export const purchaseAllocations = pgTable(
  "purchase_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    reservedCustomerId: uuid("reserved_customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    /** Percentage, e.g. 60.000000 - rule 1's rate/quantity precision, not the 2dp amount precision. App-layer enforces sum <= 100 per purchase (purchase-allocations.service.ts) - no CHECK constraint, since that sum spans multiple rows. */
    allocationPct: numeric("allocation_pct", { precision: 18, scale: 6 }).notNull(),
    ...auditColumns(),
  },
  (table) => [index("purchase_allocations_purchase_id_idx").on(table.purchaseId)],
);

/**
 * 1:1 with `purchases` (resolved open question #4). Every column is
 * optional at the spec level (table G's Mandatory column is "No"
 * throughout) - a purchase with no additional costs recorded yet simply
 * has no row. `other_charges`/`other_charges_2`/`other_charges_3` are the
 * exact fieldKey-matching column names core/field-engine/defaults.ts
 * already declares Tier-2 overrides for ("otherCharges"/"otherCharges2"/
 * "otherCharges3") - the reference case for the field engine: renaming the
 * label via PATCH /field-definitions/:id touches field_definitions only,
 * never this table, this column, or any query against it.
 */
export const purchaseAdditionalCosts = pgTable(
  "purchase_additional_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    freight: numeric("freight", { precision: 18, scale: 2 }).notNull().default("0"),
    insurance: numeric("insurance", { precision: 18, scale: 2 }).notNull().default("0"),
    customs: numeric("customs", { precision: 18, scale: 2 }).notNull().default("0"),
    otherCharges: numeric("other_charges", { precision: 18, scale: 2 }).notNull().default("0"),
    otherCharges2: numeric("other_charges_2", { precision: 18, scale: 2 }).notNull().default("0"),
    otherCharges3: numeric("other_charges_3", { precision: 18, scale: 2 }).notNull().default("0"),
    ...auditColumns(),
  },
  (table) => [uniqueIndex("purchase_additional_costs_purchase_id_key").on(table.purchaseId)],
);

export const purchaseAllocationsRelations = relations(purchaseAllocations, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseAllocations.purchaseId],
    references: [purchases.id],
  }),
  reservedCustomer: one(customers, {
    fields: [purchaseAllocations.reservedCustomerId],
    references: [customers.id],
  }),
}));

export const purchaseAdditionalCostsRelations = relations(purchaseAdditionalCosts, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseAdditionalCosts.purchaseId],
    references: [purchases.id],
  }),
}));

// --- Platform Hedging / LME Records (docs/spec/Purchase-V2.md Sub Tab 3, A-B)
// Session (d) of the Purchase build. "LME (FR-201/202) - prices go into
// market_prices first, NEVER straight onto a transaction" (this task's own
// instruction): market_prices is the append-only ledger every recorded
// price lands in FIRST, via core/pricing's PriceSource abstraction
// (ManualEntryAdapter today); an lme_record then SNAPSHOTS that price
// (lme_price_usd) plus a traceable market_price_id back to the ledger row
// it came from - never a raw number typed straight onto the transaction.
//
// Resolved open question #6: lme_records has its own lifecycle,
// independent of its purchase's draft/approved/posted status - a
// purchase can post at a provisional rate and get "fixed" later, when the
// real LME fixing date arrives. Each fixing is a new, immutable row
// (never updated after insert - "corrections are reversal + re-entry",
// rule 8) - hence 1-to-many under purchases, add-only, no update/delete
// repository function at all.
//
// Resolved open question #8: hedges is likewise 1-to-many under
// purchases (staged/partial hedging), also independent of the purchase's
// own status. Unlike lme_records, a hedge's `status` (open/closed) is a
// genuine mutable lifecycle field on the SAME row - closing a position
// isn't a correction, it's the position's own history - so hedges gets
// one narrow update path (status only; contract terms are immutable
// once entered).
export const marketPriceSourceEnum = pgEnum("market_price_source", ["manual"]);

/**
 * Immutable (rule 8's "no hard deletes" plus, here, no updates either -
 * enforced by having no update/delete repository function, not a DB
 * trigger). `metal` is deliberately plain text, not an `items` FK: LME
 * quotes a base metal (Copper, Aluminum, ...), not a specific graded/
 * packaged SKU - conflating the two would be wrong, and "metals" isn't in
 * §4's "masters required by this module" list. `entered_by` (the spec's
 * own column name) is `created_by` from `auditColumns()` - the same
 * concept, the codebase's standard name for it.
 */
export const marketPrices = pgTable("market_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  lmeExchangeId: uuid("lme_exchange_id")
    .notNull()
    .references(() => lmeExchanges.id, { onDelete: "restrict" }),
  metal: text("metal").notNull(),
  price: numeric("price", { precision: 18, scale: 6 }).notNull(),
  effectiveDate: date("effective_date").notNull(),
  source: marketPriceSourceEnum("source").notNull(),
  ...auditColumns(),
});

/**
 * FR-201/FR-202/FR-203. `market_price_id` is NOT NULL - see this
 * section's doc comment: an lme_record can only ever exist because a
 * market_prices row was recorded first. `final_purchase_rate_usd` is
 * FR-203's calculated field (never accepted from a client), computed and
 * rounded exactly once at insert time (ADR 0012), from the same
 * full-precision chain as `lme_price_usd` x `(agreed_premium_pct / 100)`
 * - a DIRECT multiplier, not a markup added on top (client-confirmed
 * correction: LME 100 x agreed 98% = 98, not 104 - "agreed_premium_pct"
 * is a misnomer left in place because renaming the column isn't worth
 * the migration; it is never additive, see agreedPremiumPct below) -
 * never recomputed later, since this row is never updated.
 */
export const lmeTypeEnum = pgEnum("lme_type", ["open", "close", "cash"]);

export const lmeRecords = pgTable(
  "lme_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    /** "Purchase Reference | Lookup | Purchase ID" (spec table A). */
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "restrict" }),
    lmeExchangeId: uuid("lme_exchange_id")
      .notNull()
      .references(() => lmeExchanges.id, { onDelete: "restrict" }),
    marketPriceId: uuid("market_price_id")
      .notNull()
      .references(() => marketPrices.id, { onDelete: "restrict" }),
    /** Snapshotted from market_prices.metal at insert time (purchase-lme.service.ts) - same reasoning as lmePriceUsd/fixingDate/agreedPremiumPct below: a value that also lives on market_prices, but captured here too so this row is a self-contained record of what was recorded, not a dangling reference. */
    metal: text("metal").notNull(),
    /** Prompt 21 item 3: a categorization field only - no calculation depends on it yet. Nullable at the DB level: existing lme_records rows have no sensible value to backfill to, so they're left null; new rows require it via addLmeRecordSchema. */
    lmeType: lmeTypeEnum("lme_type"),
    lmePriceUsd: numeric("lme_price_usd", { precision: 18, scale: 6 }).notNull(),
    fixingDate: date("fixing_date").notNull(),
    /** Misnamed column (kept as-is - not worth a migration): despite "premium", this is the AGREED PERCENTAGE OF the LME price, a direct multiplier - 98 means the final rate is 98% of LME, not LME+98%. See finalPurchaseRateUsd below and purchase-lme.service.ts's addLmeRecord. */
    agreedPremiumPct: numeric("agreed_premium_pct", { precision: 18, scale: 6 }).notNull(),
    finalPurchaseRateUsd: numeric("final_purchase_rate_usd", { precision: 18, scale: 6 }).notNull(),
    ...auditColumns(),
  },
  (table) => [index("lme_records_purchase_id_idx").on(table.purchaseId)],
);

export const hedgePositionEnum = pgEnum("hedge_position", ["buy", "sell"]);
/** Not in the spec's own field list (table B has no options for "Hedge Status") - a reasonable minimal open/closed lifecycle, not a business rule invented beyond what's needed to make the column usable. */
export const hedgeStatusEnum = pgEnum("hedge_status", ["open", "closed"]);

/** FR-204. Contract terms (platform/contract_number/position/quantity/rate/hedge_date) are immutable once entered - only `status` is ever patched (purchase-hedges.service.ts), the position's own open->closed lifecycle, not a correction. */
export const hedges = pgTable(
  "hedges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "restrict" }),
    hedgePlatformId: uuid("hedge_platform_id")
      .notNull()
      .references(() => hedgePlatforms.id, { onDelete: "restrict" }),
    contractNumber: text("contract_number").notNull(),
    position: hedgePositionEnum("position").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    hedgeDate: date("hedge_date").notNull(),
    status: hedgeStatusEnum("status").notNull().default("open"),
    ...auditColumns(),
  },
  (table) => [index("hedges_purchase_id_idx").on(table.purchaseId)],
);

export const marketPricesRelations = relations(marketPrices, ({ one }) => ({
  lmeExchange: one(lmeExchanges, {
    fields: [marketPrices.lmeExchangeId],
    references: [lmeExchanges.id],
  }),
}));

export const lmeRecordsRelations = relations(lmeRecords, ({ one }) => ({
  purchase: one(purchases, {
    fields: [lmeRecords.purchaseId],
    references: [purchases.id],
  }),
  lmeExchange: one(lmeExchanges, {
    fields: [lmeRecords.lmeExchangeId],
    references: [lmeExchanges.id],
  }),
  marketPrice: one(marketPrices, {
    fields: [lmeRecords.marketPriceId],
    references: [marketPrices.id],
  }),
}));

export const hedgesRelations = relations(hedges, ({ one }) => ({
  purchase: one(purchases, {
    fields: [hedges.purchaseId],
    references: [purchases.id],
  }),
  hedgePlatform: one(hedgePlatforms, {
    fields: [hedges.hedgePlatformId],
    references: [hedgePlatforms.id],
  }),
}));

// --- PL-2 (docs/PURCHASE-LIFECYCLE-4DOC.md, ADR 0017): the Bill -----------
// Renamed from Prompt 22's "Supplier Invoice" (CLAUDE.md's Vocabulary
// section: "Bill" is canonical, "supplier invoice" is not - one word for
// one thing). Still the financial-liability document PL-1/ADR 0016 already
// decoupled from stock: a purchase order is intent, a receipt is the
// physical fact, a BILL is the financial fact. One-to-many with `purchases`
// (a purchase HAS bills - partial billing is now a real, first-class case,
// not just schema headroom - see purchase-bills.service.ts's
// ALLOW_PARTIAL_BILLING flag and purchase_bill_items below).
export const purchaseBillStatusEnum = pgEnum("purchase_bill_status", ["draft", "approved", "reversed", "paid"]);

/**
 * `reversed` exists for a future whole-bill cancellation flow (not built
 * yet - same "add the value now, wire it up later" precedent as
 * broker_commission_type). `paid` is reserved for the deferred Payment
 * phase (PL-2's own scope note: do NOT build payment now) - nothing
 * transitions a bill to `paid` yet.
 */
export const purchaseBills = pgTable(
  "purchase_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "restrict" }),
    /** Own gapless series (docType "BILL", rule 7) - a bill is its own fiscal document, numbered independently of the PO, the receipt, and any prior SUPPLIER_INVOICE-numbered row (that series is left alone; existing SINV-numbered bills keep their historical numbers, rule 8's spirit - numbering is never rewritten). */
    billNumber: text("bill_number").notNull(),
    /** The supplier's own invoice reference - free text, distinct from billNumber (this system's own gapless number). */
    supplierInvoiceNo: text("supplier_invoice_no"),
    billDate: date("bill_date").notNull(),
    /** PL-2: when payment is due - informational only (no dunning/ageing logic; that's the deferred Payment phase's job). Nullable - not every bill's due date is known/entered at create time. */
    dueDate: date("due_date"),
    status: purchaseBillStatusEnum("status").notNull().default("draft"),
    /** What the supplier's invoice states as its total - mandatory (it's the whole point of the document), reference/reconciliation only, never fed into any calculation of its own (rule 1: numeric, decimal.js at the repository boundary) - though purchase.service.ts's getById DOES compute a variance FROM it, for display only, never a block. */
    billAmountUsd: numeric("bill_amount_usd", { precision: 18, scale: 2 }).notNull(),
    /** PL-2 item 5: a clean seam only - tax is multi-country and an open client question (CLAUDE.md's "Do NOT import from Zoho" - no TDS/TCS mechanics). Nullable, reference-only, never computed or enforced. The real tax engine waits on the client's answer (see ADR 0017). */
    taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("purchase_bills_company_id_bill_number_key")
      .on(table.companyId, table.billNumber)
      .where(sql`${table.deletedAt} is null`),
    index("purchase_bills_purchase_id_idx").on(table.purchaseId),
  ],
);

/**
 * PL-2: which purchase_item(s) this bill covers and how much of each is
 * being billed - mirrors purchase_receipt_items' shape exactly (billed
 * qty can be < ordered qty; multiple bills per PO until fully billed).
 * `billedAmountUsd` is this line's own amount (not derived from the
 * purchase item's own pricing) - the supplier's invoice states its own
 * per-line price, which may differ from what the PO recorded, same
 * "reference only" treatment as the bill's own header total.
 */
export const purchaseBillItems = pgTable(
  "purchase_bill_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => purchaseBills.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    purchaseItemId: uuid("purchase_item_id")
      .notNull()
      .references(() => purchaseItems.id, { onDelete: "restrict" }),
    billedQuantity: numeric("billed_quantity", { precision: 18, scale: 6 }).notNull(),
    billedAmountUsd: numeric("billed_amount_usd", { precision: 18, scale: 2 }).notNull(),
    ...auditColumns(),
  },
  (table) => [index("purchase_bill_items_bill_id_idx").on(table.billId), index("purchase_bill_items_purchase_item_id_idx").on(table.purchaseItemId)],
);

export const purchaseBillsRelations = relations(purchaseBills, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [purchaseBills.purchaseId],
    references: [purchases.id],
  }),
  branch: one(branches, {
    fields: [purchaseBills.branchId],
    references: [branches.id],
  }),
  items: many(purchaseBillItems),
}));

export const purchaseBillItemsRelations = relations(purchaseBillItems, ({ one }) => ({
  bill: one(purchaseBills, {
    fields: [purchaseBillItems.billId],
    references: [purchaseBills.id],
  }),
  purchaseItem: one(purchaseItems, {
    fields: [purchaseBillItems.purchaseItemId],
    references: [purchaseItems.id],
  }),
}));

// --- PL-1: Purchase Receipt (four-document lifecycle, docs/PURCHASE-
// LIFECYCLE-4DOC.md) -----------------------------------------------------
// Supersedes Prompt 22's design (ADR 0015): stock no longer moves on
// invoice approval. A purchase order is intent; the Bill is a financial
// fact; only the RECEIPT - the physical arrival of goods - is a physical
// fact, so only confirming a receipt writes stock_movements. The Bill
// (purchase_bills, renamed from purchase_invoices in PL-2) is purely
// financial (no stock coupling, no reverse-then-reissue reconciliation -
// see ADR 0016).
export const purchaseReceiptStatusEnum = pgEnum("purchase_receipt_status", ["draft", "confirmed", "reversed"]);

/**
 * One purchase can have MULTIPLE receipts (partial shipments arrive over
 * time) - purchaseId is a plain FK, not unique, unlike purchase_shipments'
 * 1:1. `reversed` exists for a future whole-receipt cancellation flow
 * (not built by PL-1 - confirming is the only transition today), same
 * "add the value now, wire it up later" precedent as purchase_bills' own
 * `reversed`.
 */
export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "restrict" }),
    /** Own gapless series (docType "PURCHASE_RECEIPT", rule 7) - a receipt is its own fiscal document, numbered independently of the PO and any invoice. */
    receiptNumber: text("receipt_number").notNull(),
    receiptDate: date("receipt_date").notNull(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: purchaseReceiptStatusEnum("status").notNull().default("draft"),
    confirmedBy: uuid("confirmed_by").references(() => users.id, { onDelete: "restrict" }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("purchase_receipts_company_id_receipt_number_key")
      .on(table.companyId, table.receiptNumber)
      .where(sql`${table.deletedAt} is null`),
    index("purchase_receipts_purchase_id_idx").on(table.purchaseId),
  ],
);

/**
 * Which purchase_item(s) this receipt covers and how much of each
 * actually arrived - `receivedQuantity` can be less than the purchase
 * item's own ordered `quantity` (a partial receipt); the guard that sums
 * received-across-all-receipts <= ordered lives in the service layer
 * (purchase-receipts.service.ts), not here, matching this codebase's
 * "only cross-row invariants that need a query live outside the schema"
 * convention (e.g. ALLOW_PARTIAL_INVOICING).
 */
export const purchaseReceiptItems = pgTable(
  "purchase_receipt_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => purchaseReceipts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    purchaseItemId: uuid("purchase_item_id")
      .notNull()
      .references(() => purchaseItems.id, { onDelete: "restrict" }),
    receivedQuantity: numeric("received_quantity", { precision: 18, scale: 6 }).notNull(),
    ...auditColumns(),
  },
  (table) => [index("purchase_receipt_items_receipt_id_idx").on(table.receiptId), index("purchase_receipt_items_purchase_item_id_idx").on(table.purchaseItemId)],
);

export const purchaseReceiptsRelations = relations(purchaseReceipts, ({ one, many }) => ({
  purchase: one(purchases, {
    fields: [purchaseReceipts.purchaseId],
    references: [purchases.id],
  }),
  branch: one(branches, {
    fields: [purchaseReceipts.branchId],
    references: [branches.id],
  }),
  warehouse: one(warehouses, {
    fields: [purchaseReceipts.warehouseId],
    references: [warehouses.id],
  }),
  items: many(purchaseReceiptItems),
}));

export const purchaseReceiptItemsRelations = relations(purchaseReceiptItems, ({ one }) => ({
  receipt: one(purchaseReceipts, {
    fields: [purchaseReceiptItems.receiptId],
    references: [purchaseReceipts.id],
  }),
  purchaseItem: one(purchaseItems, {
    fields: [purchaseReceiptItems.purchaseItemId],
    references: [purchaseItems.id],
  }),
}));

// --- PL-5 (docs/PURCHASE-LIFECYCLE-4DOC.md): Payment ----------------------
// The 4th and final lifecycle document - deferred through PL-1/2/3/4, now
// built. Scoped to a SUPPLIER, not a single purchase or bill - Zoho's own
// "Payments Made" model, which this mirrors: one payment can settle
// several bills for the same supplier in one transaction (payment_
// allocations is the join, one row per bill it touches), and a single
// bill can be paid across several payments (partial payment). No status
// enum on the payment itself - unlike Receipt/Bill, a payment is a single
// atomic event recorded once (no draft/confirm lifecycle - Zoho's own
// Payments Made has no draft state either); its EFFECT (how much of a
// bill is settled) is what's derived, on purchase_bills, the same
// "compute on read from a sum" pattern PL-1/PL-2's received/billed axes
// already established.
export const paymentModeEnum = pgEnum("payment_mode", ["cash", "cheque", "bank_transfer", "other"]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    /** A payment is made TO a supplier, not to a single purchase/bill - the bill(s) it settles are named in payment_allocations below, which can span multiple purchases for the same supplier. */
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    /** Own gapless series (docType "PAYMENT", rule 7) - a payment is its own fiscal document. */
    paymentNumber: text("payment_number").notNull(),
    paymentDate: date("payment_date").notNull(),
    paymentMode: paymentModeEnum("payment_mode").notNull(),
    /** Free text - a cheque number, a wire transfer reference, etc. No bank-account master exists yet (client's spec only ever gave a free-text "Bank Details" field on the supplier itself - see supplier_banks); revisit if/when one is built. */
    referenceNumber: text("reference_number"),
    /** The payment's own total - always USD (matches purchase_bills.billAmountUsd; no multi-currency payment reconciliation in this first pass). Must equal the sum of this payment's own allocations (enforced at the service layer, same "sum of children equals the parent's own total" discipline as nothing else in this schema currently needs, since Receipt/Bill both let their own sum run under the parent's total instead of requiring equality). */
    paymentAmountUsd: numeric("payment_amount_usd", { precision: 18, scale: 2 }).notNull(),
    notes: text("notes"),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("payments_company_id_payment_number_key")
      .on(table.companyId, table.paymentNumber)
      .where(sql`${table.deletedAt} is null`),
    index("payments_supplier_id_idx").on(table.supplierId),
  ],
);

/**
 * The join between a payment and the bill(s) it settles - one row per
 * bill a payment is applied to. `appliedAmountUsd` is how much of THIS
 * payment went to THIS bill - may be less than the bill's own outstanding
 * balance (partial payment, same "partial is a first-class case" pattern
 * PL-1/PL-2 established for Receipt/Bill quantities), and a bill can
 * appear across multiple payments' own allocation rows over time.
 */
export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    billId: uuid("bill_id")
      .notNull()
      .references(() => purchaseBills.id, { onDelete: "restrict" }),
    appliedAmountUsd: numeric("applied_amount_usd", { precision: 18, scale: 2 }).notNull(),
    ...auditColumns(),
  },
  (table) => [index("payment_allocations_payment_id_idx").on(table.paymentId), index("payment_allocations_bill_id_idx").on(table.billId)],
);

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [payments.supplierId],
    references: [suppliers.id],
  }),
  branch: one(branches, {
    fields: [payments.branchId],
    references: [branches.id],
  }),
  allocations: many(paymentAllocations),
}));

export const paymentAllocationsRelations = relations(paymentAllocations, ({ one }) => ({
  payment: one(payments, {
    fields: [paymentAllocations.paymentId],
    references: [payments.id],
  }),
  bill: one(purchaseBills, {
    fields: [paymentAllocations.billId],
    references: [purchaseBills.id],
  }),
}));

// --- Workflow + stock (FR-107/108, reworked by PL-1/ADR 0016) -------------
// Stock moves ONLY on Purchase Receipt Draft->Confirmed, in the SAME
// transaction as the confirmation (common/events/bus.ts: synchronous,
// transaction-scoped emit - a subscriber throw rolls back the receipt
// confirmation too). Neither PO approval nor invoice approval has any
// inventory side effect. `purchase_reversal` is the offsetting NEGATIVE
// row a future receipt-correction flow would write to undo a receipt's
// previously-moved quantity - not built by PL-1 (a confirmed receipt's
// items are immutable, matching rule 8), reserved for that later flow.
export const stockMovementTypeEnum = pgEnum("stock_movement_type", ["purchase_receipt", "purchase_reversal"]);

/**
 * Append-only ledger, NOT a mutable running-quantity column (this task's
 * own instruction) - the on-hand quantity for any item/warehouse is the
 * SUM of its movements, never a value written in place. `reference_type`/
 * `reference_id` mirror audit_logs' polymorphic entity/entityId shape:
 * today only "purchase_item" exists, a future sales issue or manual
 * adjustment would just be a new reference_type, no schema change. No
 * update/delete function exists for this table at all (same immutability
 * discipline as market_prices/lme_records) - a correction is a new,
 * offsetting movement row, never an edit to history.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "restrict" }),
    gradeId: uuid("grade_id").references(() => itemGrades.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    /** Positive = inbound. A future outbound movement (sale, adjustment) is a NEGATIVE quantity row, never a decrement of anything. */
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    uomId: uuid("uom_id")
      .notNull()
      .references(() => uom.id, { onDelete: "restrict" }),
    movementType: stockMovementTypeEnum("movement_type").notNull(),
    movementDate: date("movement_date").notNull(),
    referenceType: text("reference_type").notNull(),
    referenceId: uuid("reference_id").notNull(),
    /** Superseded by receiptId below (PL-1/ADR 0016) - kept nullable, unwritten by any current path, only so historical Prompt-22-era rows (written before the rework, back when this pointed at the same table under its old name purchase_invoices) keep resolving. Column name and FK target renamed in PL-2's rename (purchase_invoices -> purchase_bills); the physical column itself (purchase_invoice_id) is untouched to avoid rewriting historical data for a column nothing writes anymore. */
    purchaseInvoiceId: uuid("purchase_invoice_id").references(() => purchaseBills.id, { onDelete: "restrict" }),
    /** PL-1: the direct pointer to the purchase_receipt that brought the goods in - referenceType/referenceId already resolves back to the purchase (via purchase_item -> purchases, listStockMovements' own join), this is the specific document that triggered THIS movement. Nullable - a movement type PL-1 doesn't introduce (a future sale/adjustment) has no receipt at all. */
    receiptId: uuid("receipt_id").references(() => purchaseReceipts.id, { onDelete: "restrict" }),
    /** Set ONLY on a purchase_reversal row, pointing at the purchase_receipt movement it offsets - append-only-safe (a NEW row referencing an OLD one, never a mutation of the old one) way to know which receipts are still "active" vs already reconciled, without a mutable flag on the original row. Not written by PL-1 (a confirmed receipt's items are immutable); reserved for a future receipt-correction flow. */
    reversalOfMovementId: uuid("reversal_of_movement_id").references((): AnyPgColumn => stockMovements.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (table) => [
    index("stock_movements_company_item_warehouse_idx").on(table.companyId, table.itemId, table.warehouseId),
    index("stock_movements_reference_idx").on(table.referenceType, table.referenceId),
    index("stock_movements_purchase_invoice_id_idx").on(table.purchaseInvoiceId),
    index("stock_movements_receipt_id_idx").on(table.receiptId),
    // Prompt 22 Part 5: the flagged gap - quantity sign was convention-only
    // ("Positive = inbound", see the doc comment above). Enforced at the DB
    // level, not just an application-level insert helper, so no future
    // write path (this codebase's or a later one's) can silently corrupt a
    // balance by getting the sign backwards - a receipt must be positive,
    // a reversal must be negative, full stop. Compares movement_type CAST
    // TO TEXT, not the bare enum column, on purpose: this constraint is
    // added in the SAME migration that extends stock_movement_type with
    // 'purchase_reversal', and Postgres forbids using a value added by
    // ALTER TYPE ... ADD VALUE within the transaction that added it
    // ("unsafe use of new value") - that restriction is about the ENUM
    // type's cache, and never triggers for a plain text comparison.
    check(
      "stock_movements_sign_matches_type",
      sql`(${table.movementType}::text = 'purchase_receipt' AND ${table.quantity} > 0) OR (${table.movementType}::text = 'purchase_reversal' AND ${table.quantity} < 0)`,
    ),
  ],
);

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  item: one(items, {
    fields: [stockMovements.itemId],
    references: [items.id],
  }),
  grade: one(itemGrades, {
    fields: [stockMovements.gradeId],
    references: [itemGrades.id],
  }),
  warehouse: one(warehouses, {
    fields: [stockMovements.warehouseId],
    references: [warehouses.id],
  }),
  uom: one(uom, {
    fields: [stockMovements.uomId],
    references: [uom.id],
  }),
  purchaseInvoice: one(purchaseBills, {
    fields: [stockMovements.purchaseInvoiceId],
    references: [purchaseBills.id],
  }),
  receipt: one(purchaseReceipts, {
    fields: [stockMovements.receiptId],
    references: [purchaseReceipts.id],
  }),
}));

// --- C-1 (docs/CONTRACT-MODULE-BUILD.md Parts 2-3): the versioned clause ---
// library. `clauses` is stable identity - clause_code/division_id/category
// never change after creation. `clause_versions` is append-only: editing a
// clause's text is ALWAYS an INSERT of a new version row, never an UPDATE or
// DELETE of clause_text on an existing one (CLAUDE.md rule 8's spirit -
// falsifying what an already-signed contract's clause said would be a legal
// problem, not just a data-integrity one). At most one version per clause_id
// carries status='active' at any time - enforced by a partial unique index,
// not just application logic, so a bug in the promotion transaction can
// never silently leave two versions active at once.
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
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    /** Gapless (rule 7, core/numbering, docType "CLAUSE") - a clause's own permanent identity, distinct from any clause_version's own version_number. */
    clauseCode: text("clause_code").notNull(),
    clauseTitle: text("clause_title").notNull(),
    /** Nullable = applies to all divisions (docs/CONTRACT-MODULE-BUILD.md Part 2) - same optional-FK convention as purchases.divisionId. */
    divisionId: uuid("division_id").references(() => divisions.id, { onDelete: "restrict" }),
    category: clauseCategoryEnum("category").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("clauses_company_id_clause_code_key")
      .on(table.companyId, table.clauseCode)
      .where(sql`${table.deletedAt} is null`),
    index("clauses_division_id_idx").on(table.divisionId),
  ],
);

/**
 * Append-only. `changeReason` is required (docs/CONTRACT-MODULE-BUILD.md C-1
 * item 3) - a version inserted without one is a validator-level rejection,
 * not a DB constraint, since the reason is free text with no useful CHECK.
 * `effectiveFrom` may be in the future (item 5) - a version sits in
 * 'approved' until the scheduler (or the on-access fallback) promotes it to
 * 'active' once effectiveFrom <= now(), at which point the prior 'active'
 * version (if any) is flipped to 'superseded' with its own effectiveTo
 * stamped to this version's effectiveFrom, atomically.
 */
export const clauseVersions = pgTable(
  "clause_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    clauseId: uuid("clause_id")
      .notNull()
      .references(() => clauses.id, { onDelete: "restrict" }),
    /** Auto-increment per clause_id (application-assigned inside the same transaction as the insert - not a DB identity column, since "per clause_id" isn't something a table-wide serial/identity can express). */
    versionNumber: integer("version_number").notNull(),
    /** Rich text, stored as HTML (see ADR 0020) - verbatim, including any {{placeholder}} tokens (substitution is C-2's job, not this table's). */
    clauseText: text("clause_text").notNull(),
    status: clauseVersionStatusEnum("status").notNull().default("draft"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    changeReason: text("change_reason").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => [
    index("clause_versions_clause_id_idx").on(table.clauseId),
    uniqueIndex("clause_versions_clause_id_version_number_key").on(table.clauseId, table.versionNumber),
    // THE one-active-rule, enforced at the DB level (not just in the
    // promotion transaction's application logic): partial unique index on
    // (clause_id) filtered to status='active' means a second concurrent
    // promotion attempt for the same clause fails loudly (unique
    // violation) instead of silently leaving two active versions.
    uniqueIndex("clause_versions_one_active_per_clause")
      .on(table.clauseId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const clausesRelations = relations(clauses, ({ one, many }) => ({
  division: one(divisions, {
    fields: [clauses.divisionId],
    references: [divisions.id],
  }),
  versions: many(clauseVersions),
}));

export const clauseVersionsRelations = relations(clauseVersions, ({ one }) => ({
  clause: one(clauses, {
    fields: [clauseVersions.clauseId],
    references: [clauses.id],
  }),
}));

// --- C-3b (docs/CONTRACT-MODULE-BUILD.md Part 2): templates ----------------
// A template names a division + contract type and a default ORDERED clause
// set - contract_template_clauses is the ordering; the template itself
// carries no clause data. Division-scoped the same way clauses/contracts
// already are (nullable = all divisions), reusing the exact convention
// rather than inventing a new one.
export const contractTemplates = pgTable(
  "contract_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    divisionId: uuid("division_id").references(() => divisions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Free text for now (e.g. "Sale Contract", "Supply Agreement") - no contract-type MASTER exists yet and the spec doesn't name one; same "don't invent a master beyond what's asked" discipline as brokerCommissionType. */
    contractType: text("contract_type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns(),
  },
  (table) => [
    index("contract_templates_division_id_idx").on(table.divisionId),
    uniqueIndex("contract_templates_company_id_name_key").on(table.companyId, table.name).where(sql`${table.deletedAt} is null`),
  ],
);

/** The template's own default clause set, in order - `isMandatory` here (not on `clauses`) since mandatory-ness is a TEMPLATE decision (this template requires this clause), not an intrinsic property of the clause itself; the same clause can be optional in one template and mandatory in another. */
export const contractTemplateClauses = pgTable(
  "contract_template_clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => contractTemplates.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    clauseId: uuid("clause_id")
      .notNull()
      .references(() => clauses.id, { onDelete: "restrict" }),
    isMandatory: boolean("is_mandatory").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    ...auditColumns(),
  },
  (table) => [
    index("contract_template_clauses_template_id_idx").on(table.templateId),
    uniqueIndex("contract_template_clauses_template_id_clause_id_key")
      .on(table.templateId, table.clauseId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const contractTemplatesRelations = relations(contractTemplates, ({ one, many }) => ({
  division: one(divisions, {
    fields: [contractTemplates.divisionId],
    references: [divisions.id],
  }),
  templateClauses: many(contractTemplateClauses),
}));

export const contractTemplateClausesRelations = relations(contractTemplateClauses, ({ one }) => ({
  template: one(contractTemplates, {
    fields: [contractTemplateClauses.templateId],
    references: [contractTemplates.id],
  }),
  clause: one(clauses, {
    fields: [contractTemplateClauses.clauseId],
    references: [clauses.id],
  }),
}));

// --- C-3b: the contract header, now the full document ----------------------
// Extends C-3a's minimal header (materialType/weightKg/rateUsd/
// deliveryTerms - still a placeholder Scrap field set, unchanged here) with
// the real lifecycle: gapless contractNumber (core/numbering, docType
// "CONTRACT"), status Draft/Approved/Signed/Closed, parent_contract_id +
// revisionNumber (schema only, per this task's own scope decision - no
// amendment WORKFLOW built yet, every contract created today is its own
// root with parentContractId null and revisionNumber 1), and sourceType/
// sourceId for the optional purchase/sale link (LINKED prefills commercial/
// shipment fields but stays editable; STANDALONE is entered manually - both
// paths write to the same real columns here, the link is only a
// provenance pointer + a one-time prefill source, never a live foreign
// read after creation).
export const contractStatusEnum = pgEnum("contract_status", ["draft", "approved", "signed", "closed"]);
export const contractSourceTypeEnum = pgEnum("contract_source_type", ["purchase", "sale"]);
/** C-4 item 5 - mirrors clause_version_status's own "one active state machine, tracked on the row" shape. `sent` is set the instant the stub/real provider accepts the send request; `signed`/`declined` arrive via the provider's own webhook (ESignatureProvider's own interface, apps/api/src/core/esignature/). */
export const contractEsignatureStatusEnum = pgEnum("contract_esignature_status", ["not_sent", "sent", "signed", "declined"]);

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    /** Nullable, matching purchases.divisionId's own precedent - required going forward at the validator level for new contracts, never backfilled for old ones. This is also the value SchemaForm.tsx's divisionId prop reads back once a contract is loaded, so the same field set renders on reload as on create. */
    divisionId: uuid("division_id").references(() => divisions.id, { onDelete: "restrict" }),
    /** Gapless (rule 7, core/numbering, docType "CONTRACT"). */
    contractNumber: text("contract_number").notNull(),
    contractDate: date("contract_date").notNull(),
    status: contractStatusEnum("status").notNull().default("draft"),
    templateId: uuid("template_id").references(() => contractTemplates.id, { onDelete: "restrict" }),
    /**
     * The contract DOCUMENT's own kind (Sales or Purchase) - reuses
     * contractSourceTypeEnum's exact two values rather than a second
     * identical enum. Deliberately distinct from `sourceType` below:
     * `sourceType`/`sourceId` say "this contract is LINKED to that
     * purchase/sale document"; `contractType` says "this contract itself
     * IS a sale or purchase contract" - a standalone contract (no source
     * link at all) can still have a contractType, and a linked contract's
     * contractType is not required to match its sourceType (a purchase
     * contract could reference source data for context without being
     * itself the purchase). Nullable - never backfilled for a contract
     * created before this column existed, and not required going forward
     * either, since a template's own contractType already carries this
     * meaning when a template is used.
     */
    contractType: contractSourceTypeEnum("contract_type"),
    /** Self-FK - schema only for now (see this table's own doc comment above): every contract created by this build's endpoints has this NULL and revisionNumber 1. Reserved for a future amendment flow, not yet built. */
    parentContractId: uuid("parent_contract_id").references((): AnyPgColumn => contracts.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull().default(1),
    /** LINK or STANDALONE (Part 2) - both nullable, both null together = standalone. Never re-read live after the one-time prefill; a linked purchase's own later edits do NOT retroactively change this contract's already-copied commercial/shipment fields. */
    sourceType: contractSourceTypeEnum("source_type"),
    sourceId: uuid("source_id"),
    materialType: text("material_type"),
    weightKg: numeric("weight_kg", { precision: 18, scale: 6 }),
    rateUsd: numeric("rate_usd", { precision: 18, scale: 2 }),
    deliveryTerms: text("delivery_terms"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    signedBy: uuid("signed_by").references(() => users.id, { onDelete: "restrict" }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** C-4 item 4 - "Send for Approval routes to an approver": WHO this contract was routed to, stamped when sent, distinct from approvedBy (the person who actually clicked Approve, which may or may not be the same user - this table doesn't assume they must match). Nullable - not every approved contract was routed through this action (a Manager could approve directly without a prior "send"). */
    approvalRequestedFor: uuid("approval_requested_for").references(() => users.id, { onDelete: "restrict" }),
    approvalRequestedBy: uuid("approval_requested_by").references(() => users.id, { onDelete: "restrict" }),
    approvalRequestedAt: timestamp("approval_requested_at", { withTimezone: true }),
    /** C-4 items 5/9 - the e-signature STUB's own status tracking (apps/api/src/core/esignature/). No real provider is wired (spec's own explicit instruction) - these columns exist so the UI has something real to show regardless of which provider eventually fills the interface. */
    esignatureStatus: contractEsignatureStatusEnum("esignature_status").notNull().default("not_sent"),
    esignatureRequestId: text("esignature_request_id"),
    esignatureSentAt: timestamp("esignature_sent_at", { withTimezone: true }),
    esignatureCompletedAt: timestamp("esignature_completed_at", { withTimezone: true }),
    /**
     * C-4 item 6 - the generation job's result (contract-generation.service.ts's
     * own GenerationJobStatus.result) lives only in BullMQ job state, which
     * is not durable/queryable once the job ages out - these two columns are
     * the durable copy, written by markGenerationComplete right after a
     * generation job is observed as completed. A repeat generation just
     * overwrites both; there is no generation history table.
     */
    lastGeneratedDocxKey: text("last_generated_docx_key"),
    lastGeneratedPdfKey: text("last_generated_pdf_key"),
    /** C-4 item 6 - "Email Contract: send the generated PDF" - last-sent tracking only (no email history table; a repeat send just overwrites this). Nullable - never emailed yet is a normal, common state. */
    lastEmailedAt: timestamp("last_emailed_at", { withTimezone: true }),
    lastEmailedTo: text("last_emailed_to"),
    ...auditColumns(),
  },
  (table) => [
    index("contracts_division_id_idx").on(table.divisionId),
    index("contracts_parent_contract_id_idx").on(table.parentContractId),
    index("contracts_source_idx").on(table.sourceType, table.sourceId),
    uniqueIndex("contracts_company_id_contract_number_key")
      .on(table.companyId, table.contractNumber)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  division: one(divisions, {
    fields: [contracts.divisionId],
    references: [divisions.id],
  }),
  template: one(contractTemplates, {
    fields: [contracts.templateId],
    references: [contractTemplates.id],
  }),
  parties: many(contractParties),
  contractClauses: many(contractClauses),
}));

/**
 * Seller/buyer, resolved to Supplier/Customer masters (CLAUDE.md
 * vocabulary - never "Vendor"), mirroring purchases.supplierId's direct-FK
 * convention rather than a generic polymorphic party table (no precedent
 * for that pattern anywhere in this schema, and it would cross the "every
 * business table is company_id-scoped, never generic" grain). One row per
 * party per contract (partyRole distinguishes seller from buyer) rather
 * than two columns on `contracts` itself, since a broker-as-third-party or
 * multiple buyers is easy headroom this shape leaves open without a
 * migration, matching purchase_allocations' own "many, not a single
 * column" precedent for a similar shape.
 */
export const contractPartyRoleEnum = pgEnum("contract_party_role", ["seller", "buyer"]);

export const contractParties = pgTable(
  "contract_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    partyRole: contractPartyRoleEnum("party_role").notNull(),
    supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "restrict" }),
    ...auditColumns(),
  },
  (table) => [
    index("contract_parties_contract_id_idx").on(table.contractId),
    uniqueIndex("contract_parties_contract_id_party_role_key")
      .on(table.contractId, table.partyRole)
      .where(sql`${table.deletedAt} is null`),
    check(
      "contract_parties_exactly_one_party_check",
      sql`(${table.supplierId} is not null)::int + (${table.customerId} is not null)::int = 1`,
    ),
  ],
);

export const contractPartiesRelations = relations(contractParties, ({ one }) => ({
  contract: one(contracts, {
    fields: [contractParties.contractId],
    references: [contracts.id],
  }),
  supplier: one(suppliers, {
    fields: [contractParties.supplierId],
    references: [suppliers.id],
  }),
  customer: one(customers, {
    fields: [contractParties.customerId],
    references: [customers.id],
  }),
}));

/**
 * THE SNAPSHOT (Part 2's own emphasis). Frozen per-contract clause rows -
 * clauseVersionId is the legal anchor, resolved ONCE at assembly time and
 * never re-read from the live clause afterward. resolvedText is the
 * placeholder-substituted text (C-2's resolvePlaceholders), computed at
 * the SAME assembly moment - editing the clause library later (a new
 * clause_versions row, even promoting a different version to Active) must
 * never change what's stored here. Approved/Signed contracts: this table
 * is never written to again for that contract. Draft: an explicit
 * "update clauses to latest" action re-snapshots (new resolvedText/
 * clauseVersionId per clause), never a silent background refresh.
 */
export const contractClauses = pgTable(
  "contract_clauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    clauseId: uuid("clause_id")
      .notNull()
      .references(() => clauses.id, { onDelete: "restrict" }),
    /** The legal anchor - frozen forever once written for an Approved/Signed contract. Nullable only because a Draft's clause could theoretically be added before any version is Active yet (blocked at the service layer today - every clause has an Active version by the time it's addable - but the column itself doesn't assume that). */
    clauseVersionId: uuid("clause_version_id").references(() => clauseVersions.id, { onDelete: "restrict" }),
    /** Placeholder-substituted text, computed once at snapshot time (C-2's resolvePlaceholders) - resolve DISPLAY through this column, never the live clause_versions.clause_text. */
    resolvedText: text("resolved_text").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** True if a clause_rules evaluation added this (C-4 - not built yet, always false today, column exists so C-4 doesn't need a migration). */
    isFromRule: boolean("is_from_rule").notNull().default(false),
    /** True once this contract's own copy of resolvedText has been hand-edited on THIS contract (assembly's "edit an editable clause's text" action) - the edit NEVER touches clauses/clause_versions, only this row. */
    isEdited: boolean("is_edited").notNull().default(false),
    /** From the template that was mandatory when assembled - blocks removal at the service layer even if the template itself later changes. */
    isMandatory: boolean("is_mandatory").notNull().default(false),
    snapshotTakenAt: timestamp("snapshot_taken_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns(),
  },
  (table) => [
    index("contract_clauses_contract_id_idx").on(table.contractId),
    uniqueIndex("contract_clauses_contract_id_sort_order_key")
      .on(table.contractId, table.sortOrder)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const contractClausesRelations = relations(contractClauses, ({ one }) => ({
  contract: one(contracts, {
    fields: [contractClauses.contractId],
    references: [contracts.id],
  }),
  clause: one(clauses, {
    fields: [contractClauses.clauseId],
    references: [clauses.id],
  }),
  clauseVersion: one(clauseVersions, {
    fields: [contractClauses.clauseVersionId],
    references: [clauseVersions.id],
  }),
}));

/**
 * C-4 (docs/CONTRACT-MODULE-BUILD.md): data-driven rule engine
 * (json-rules-engine, NEVER a hand-rolled DSL) - a rule is a CONDITION on
 * contract data (e.g. incoterm=='CIF') and an ACTION (add clause X,
 * optionally as mandatory). `conditionJson` is json-rules-engine's own
 * condition-tree shape verbatim ({all:[...]} / {any:[...]} of {fact,
 * operator, value} leaves) - stored opaquely, never parsed/validated by
 * this schema, so the engine library owns the condition grammar, not this
 * table. `isExample` is REQUIRED, not cosmetic: docs/CONTRACT-MODULE-
 * BUILD.md's own repeated warning is that real rules are unknown until
 * the client provides them - every rule this build seeds is an EXAMPLE,
 * and the column exists so the rules-management UI can visibly label
 * every current row as such rather than let an example rule look
 * indistinguishable from a client-confirmed one.
 */
export const clauseRules = pgTable(
  "clause_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "restrict" }),
    divisionId: uuid("division_id").references(() => divisions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** json-rules-engine's own condition-tree JSON, e.g. `{"all":[{"fact":"incoterm","operator":"equal","value":"CIF"}]}` - opaque to this schema. */
    conditionJson: jsonb("condition_json").$type<Record<string, unknown>>().notNull(),
    targetClauseId: uuid("target_clause_id")
      .notNull()
      .references(() => clauses.id, { onDelete: "restrict" }),
    /** Whether a clause this rule adds becomes non-removable (contract_clauses.isMandatory) - the SAME generic guard contract-assembly.service.ts's removeClause already enforces for template-sourced mandatory clauses. */
    actionIsMandatory: boolean("action_is_mandatory").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /** See this table's own doc comment above - never omit-by-default; a rule seeded by this build's own example set is always true, a client-confirmed rule (none exist yet) would be false. */
    isExample: boolean("is_example").notNull().default(true),
    ...auditColumns(),
  },
  (table) => [
    index("clause_rules_division_id_idx").on(table.divisionId),
    index("clause_rules_target_clause_id_idx").on(table.targetClauseId),
  ],
);

export const clauseRulesRelations = relations(clauseRules, ({ one }) => ({
  division: one(divisions, {
    fields: [clauseRules.divisionId],
    references: [divisions.id],
  }),
  targetClause: one(clauses, {
    fields: [clauseRules.targetClauseId],
    references: [clauses.id],
  }),
}));
