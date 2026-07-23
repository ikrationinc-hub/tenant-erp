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

// --- Purchase: header + shipment (docs/spec/Purchase-V2.md Sub Tab 2, A-C) -
// Session (a) of the Purchase build ("the big one" - split across
// sessions per that task's instruction). Items/pricing/allocation/costs/
// attachments (D-H) and LME/hedging/workflow/stock (Sub Tab 3, FR-107/108)
// are later sessions - NOT built here. `status` exists as a column now
// (the spec's Purchase Header table requires it) but nothing in this
// session ever moves it off "draft" - the actual Draft->Approved->Posted
// transitions, their permissions, and Posted immutability (CLAUDE.md rule
// 8) are the workflow engine, explicitly deferred to session (e).
export const purchaseStatusEnum = pgEnum("purchase_status", ["draft", "approved", "posted"]);

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
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** "Buyer | Dropdown | User" (spec table A) - a tenant user, not a master. */
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** FR-102: from Supplier Master, never free text. */
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    supplierInvoiceNo: text("supplier_invoice_no"),
    supplierReferenceNo: text("supplier_reference_no"),
    /** Sub Tab 2's "Standard fields - every record": "Approved By · Approved Date" - the only workflow-transition actor/timestamp the spec names explicitly (no "Posted By/Date" - that transition's actor is still fully recoverable from audit_logs, same as everywhere else in this build). Set once, by session (e)'s approve() transition; never touched again. */
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
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
    containerNumber: text("container_number").notNull(),
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

export const purchasesRelations = relations(purchases, ({ one }) => ({
  company: one(companies, {
    fields: [purchases.companyId],
    references: [companies.id],
  }),
  branch: one(branches, {
    fields: [purchases.branchId],
    references: [branches.id],
  }),
  buyer: one(users, {
    fields: [purchases.buyerId],
    references: [users.id],
  }),
  supplier: one(suppliers, {
    fields: [purchases.supplierId],
    references: [suppliers.id],
  }),
  shipment: one(purchaseShipments, {
    fields: [purchases.id],
    references: [purchaseShipments.purchaseId],
  }),
}));

export const purchaseShipmentsRelations = relations(purchaseShipments, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseShipments.purchaseId],
    references: [purchases.id],
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
 * full-precision chain as `lme_price_usd` x
 * `(1 + agreed_premium_pct / 100)` - never recomputed later, since this
 * row is never updated.
 */
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
    lmePriceUsd: numeric("lme_price_usd", { precision: 18, scale: 6 }).notNull(),
    fixingDate: date("fixing_date").notNull(),
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

// --- Workflow + stock (FR-107/108, session (e) - the last piece of "the
// big one") ----------------------------------------------------------------
// Resolved open question #10: stock moves at Approved, not Posted - FR-108
// literally says "Approved purchase updates inventory." Posted is a pure
// accounting lock on top (rule 8's immutability), with no inventory effect
// of its own. The Draft->Approved transition emits `purchase.approved` on
// common/events/bus.ts; modules/inventory's subscriber (registered at boot,
// never imported by modules/purchase - "modules must not call each other
// directly") writes these rows in the SAME transaction as the approval,
// so the two can never diverge (a failure in either rolls back both).
export const stockMovementTypeEnum = pgEnum("stock_movement_type", ["purchase_receipt"]);

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
    ...auditColumns(),
  },
  (table) => [
    index("stock_movements_company_item_warehouse_idx").on(table.companyId, table.itemId, table.warehouseId),
    index("stock_movements_reference_idx").on(table.referenceType, table.referenceId),
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
}));
