import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Worker-local mirror of apps/api/src/database/platform/schema.ts's `tenants` table - only the columns the tenant-loop (clause-promotion.worker.ts) reads. */
export const platformSchema = pgSchema("platform");

export const tenantStatusEnum = platformSchema.enum("tenant_status", ["provisioning", "active", "suspended"]);

export const tenants = platformSchema.table("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  schemaName: text("schema_name").notNull(),
  status: tenantStatusEnum("status").notNull().default("provisioning"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
