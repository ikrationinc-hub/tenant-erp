import { eq } from "drizzle-orm";
import { db } from "../../config/db.js";
import { applyPendingTenantMigrations } from "../../database/migration-runner.js";
import { tenants } from "../../database/platform/schema.js";
import { slugToTenantSchemaName } from "../../database/tenant/schema-name.js";
import { RESOLVED_MODULES } from "../module-registry/registry.js";
import { seedTenantModules } from "../module-registry/tenant-modules.js";
import { seedPermissionCatalogue } from "../rbac/seed.js";

export interface CreateTenantSchemaInput {
  name: string;
  slug: string;
}

export type ProvisionedTenant = typeof tenants.$inferSelect;

/**
 * Creates tenant_<slug>, runs the tenant migrations against it, and records
 * the tenant in the platform schema. The tenants row is inserted BEFORE
 * provisioning (its unique slug/schema_name constraints double as a guard
 * against a concurrent duplicate provision) and flipped to 'active' only
 * after the schema and migrations succeed - a failure here leaves the row
 * visibly stuck in 'provisioning' rather than silently disappearing.
 */
export async function createTenantSchema(input: CreateTenantSchemaInput): Promise<ProvisionedTenant> {
  const schemaName = slugToTenantSchemaName(input.slug);

  const [tenant] = await db
    .insert(tenants)
    .values({ name: input.name, slug: input.slug, schemaName })
    .returning();

  if (!tenant) {
    throw new Error("failed to insert tenant row");
  }

  await applyPendingTenantMigrations(schemaName);
  await seedPermissionCatalogue(schemaName);
  await seedTenantModules(tenant.id, RESOLVED_MODULES);

  const [activated] = await db
    .update(tenants)
    .set({ status: "active" })
    .where(eq(tenants.id, tenant.id))
    .returning();

  return activated ?? tenant;
}
