import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { closeRedis } from "../src/config/redis.js";
import { tenants } from "../src/database/platform/schema.js";
import { companies, users } from "../src/database/tenant/schema.js";
import { seedDefaultMenuTree } from "../src/core/provisioning/seed-menu-tree.js";

/**
 * One-off: seed-menu-tree.ts's icon keys for companies/branches/
 * field-definitions/brokers/inventory changed (deduped away from a shared
 * "database"/"shop" icon). seedDefaultMenuTree upserts by (companyId, key)
 * and is documented as safely re-runnable against an already-provisioned
 * tenant, so re-running it per company syncs the new icon values into
 * already-seeded menu rows - no raw SQL, reuses the exact path
 * provisioning itself uses.
 */
async function backfillTenant(schemaName: string): Promise<void> {
  const companyRows = await withTenantSchema(schemaName, (tx) => tx.select().from(companies));

  for (const company of companyRows) {
    const [anyUser] = await withTenantSchema(schemaName, (tx) =>
      tx.select().from(users).where(eq(users.companyId, company.id)).limit(1),
    );
    if (!anyUser) {
      logger.warn({ schemaName, companyId: company.id }, "no user found for company, skipping");
      continue;
    }

    await seedDefaultMenuTree({ schemaName, companyId: company.id, createdBy: anyUser.id });
    console.log(`  ${schemaName} / ${company.name}: menu icons re-synced`);
  }
}

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
  for (const tenant of activeTenants) {
    await backfillTenant(tenant.schemaName);
  }
  console.log(`\nOK: ${activeTenants.length} tenant(s) processed\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "menu icon backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });
