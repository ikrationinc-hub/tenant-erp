import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
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
// "purchase.po.approve", "masters.supplier.create". `permissions` is a
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

// --- Reference masters ----------------------------------------------------
// One generic table, not four near-identical ones (country/currency/uom/
// incoterm) - CLAUDE.md's field model already anticipates "~16 masters via
// one generic pattern" as later, dedicated work; this is a deliberately
// small precursor for the one thing THIS task needs (provisioning seeds a
// handful of standard reference lists), not an attempt to build that
// generic pattern early. Tenant-wide, no company_id: a country or currency
// code means the same thing for every company in the tenant, same
// reasoning as `permissions`.

export const referenceMasterTypeEnum = pgEnum("reference_master_type", [
  "country",
  "currency",
  "uom",
  "incoterm",
]);

export const referenceMasters = pgTable(
  "reference_masters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: referenceMasterTypeEnum("type").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("reference_masters_type_code_key").on(table.type, table.code)],
);

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
    ...auditColumns(),
  },
  (table) => [
    uniqueIndex("field_definitions_company_module_entity_field_key")
      .on(table.companyId, table.module, table.entity, table.fieldKey)
      .where(sql`${table.deletedAt} is null`),
    check("field_definitions_tier_check", sql`${table.tier} = 2`),
  ],
);

export const fieldDefinitionsRelations = relations(fieldDefinitions, ({ one }) => ({
  company: one(companies, {
    fields: [fieldDefinitions.companyId],
    references: [companies.id],
  }),
}));
