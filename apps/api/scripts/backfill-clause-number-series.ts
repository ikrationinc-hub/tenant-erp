import { eq } from "drizzle-orm";
import { db, closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { withTenantSchema, closeTenantDbPool } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { companies, users } from "../src/database/tenant/schema.js";
import { seedDefaultNumberSeries } from "../src/core/provisioning/seed-number-series.js";

/**
 * One-off: C-1 (docs/CONTRACT-MODULE-BUILD.md) added CLAUSE to seed-
 * number-series.ts's DEFAULT_SERIES, same gap every prior number-series
 * backfill in this directory closes - already-active tenants never get a
 * CLAUSE number_series row on their own, and nextNumber() throws "No
 * number series configured" the first time anyone tries to create a
 * clause. seedDefaultNumberSeries is idempotent (onConflictDoNothing per
 * company/branch/docType/FY), so re-running it for every company of every
 * active tenant only inserts the missing CLAUSE row.
 */
async function backfillTenant(schemaName: string): Promise<void> {
  const companyRows = await withTenantSchema(schemaName, (tx) => tx.select().from(companies));

  for (const company of companyRows) {
    const [anyUser] = await withTenantSchema(schemaName, (tx) =>
      tx.select().from(users).where(eq(users.companyId, company.id)).limit(1),
    );
    if (!anyUser) continue;

    await seedDefaultNumberSeries({ schemaName, companyId: company.id, createdBy: anyUser.id });
    logger.info({ schemaName, companyId: company.id, companyName: company.name }, "number series backfilled");
  }
}

async function main(): Promise<void> {
  const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
  for (const tenant of activeTenants) {
    await backfillTenant(tenant.schemaName);
    console.log(`  ${tenant.slug} (${tenant.schemaName}): done`);
  }
  console.log(`\nOK: ${activeTenants.length} tenant(s) processed\n`);
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "number series backfill crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });
