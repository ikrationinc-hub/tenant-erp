import { relations } from "drizzle-orm";
import { boolean, index, inet, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const platformSchema = pgSchema("platform");

export const tenantStatusEnum = platformSchema.enum("tenant_status", [
  "provisioning",
  "active",
  "suspended",
]);

export const platformAdminStatusEnum = platformSchema.enum("platform_admin_status", [
  "active",
  "suspended",
]);

export const tenants = platformSchema.table(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    schemaName: text("schema_name").notNull(),
    status: tenantStatusEnum("status").notNull().default("provisioning"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tenants_slug_key").on(table.slug),
    uniqueIndex("tenants_schema_name_key").on(table.schemaName),
  ],
);

export const tenantModules = platformSchema.table(
  "tenant_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tenant_modules_tenant_id_module_key_key").on(table.tenantId, table.moduleKey)],
);

export const platformAdmins = platformSchema.table(
  "platform_admins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    status: platformAdminStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("platform_admins_email_key").on(table.email)],
);

export const platformLoginOutcomeEnum = platformSchema.enum("platform_login_outcome", ["success", "failure"]);

/**
 * Deliberately its own table, not a reuse of tenant.refresh_tokens (ADM-1
 * task item 2) - a platform admin isn't a row in any tenant schema, so a
 * shared table would need a nullable, cross-cutting FK that violates rule 9
 * (no FK from a tenant schema to platform - and the reverse, a platform
 * table FK'd by nothing tenant-shaped, is the same principle from the other
 * direction). Mirrors tenant.refresh_tokens' rotation-family shape exactly.
 */
export const platformRefreshTokens = platformSchema.table(
  "platform_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformAdminId: uuid("platform_admin_id")
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_refresh_tokens_family_id_idx").on(table.familyId),
    index("platform_refresh_tokens_platform_admin_id_idx").on(table.platformAdminId),
  ],
);

export const platformLoginHistory = platformSchema.table(
  "platform_login_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platformAdminId: uuid("platform_admin_id").references(() => platformAdmins.id, { onDelete: "set null" }),
    attemptedEmail: text("attempted_email").notNull(),
    outcome: platformLoginOutcomeEnum("outcome").notNull(),
    reason: text("reason"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("platform_login_history_platform_admin_id_idx").on(table.platformAdminId),
    index("platform_login_history_attempted_email_idx").on(table.attemptedEmail),
  ],
);

export const tenantsRelations = relations(tenants, ({ many }) => ({
  modules: many(tenantModules),
}));

export const tenantModulesRelations = relations(tenantModules, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantModules.tenantId],
    references: [tenants.id],
  }),
}));

export const platformAdminsRelations = relations(platformAdmins, ({ many }) => ({
  refreshTokens: many(platformRefreshTokens),
  loginHistory: many(platformLoginHistory),
}));

export const platformRefreshTokensRelations = relations(platformRefreshTokens, ({ one }) => ({
  platformAdmin: one(platformAdmins, {
    fields: [platformRefreshTokens.platformAdminId],
    references: [platformAdmins.id],
  }),
}));

export const platformLoginHistoryRelations = relations(platformLoginHistory, ({ one }) => ({
  platformAdmin: one(platformAdmins, {
    fields: [platformLoginHistory.platformAdminId],
    references: [platformAdmins.id],
  }),
}));
