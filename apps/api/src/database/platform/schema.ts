import { relations } from "drizzle-orm";
import { boolean, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

export const tenantsRelations = relations(tenants, ({ many }) => ({
  modules: many(tenantModules),
}));

export const tenantModulesRelations = relations(tenantModules, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantModules.tenantId],
    references: [tenants.id],
  }),
}));
