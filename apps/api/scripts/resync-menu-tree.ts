import { eq } from "drizzle-orm";
import { db } from "../src/config/db.js";
import { closeDbPool } from "../src/config/db.js";
import { closeRedis } from "../src/config/redis.js";
import { closeTenantDbPool, withTenantSchema } from "../src/database/get-db.js";
import { tenants } from "../src/database/platform/schema.js";
import { companies, users } from "../src/database/tenant/schema.js";
import { seedDefaultMenuTree } from "../src/core/provisioning/seed-menu-tree.js";

/**
 * `pnpm resync-menu-tree --tenant=<slug>` - re-applies DEFAULT_MENU_TREE's
 * current label/path/icon/permission to a tenant that was already
 * provisioned. createMenu upserts by (companyId, key) and
 * seedDefaultMenuTree is explicitly documented as safe to re-run (it's how
 * a node added after a tenant's first provisioning gets backfilled) - there
 * was just no CLI entrypoint for doing that outside provision-tenant.ts/
 * provision-company.ts. Needed whenever seed-menu-tree.ts changes (e.g. an
 * icon key) after a tenant already exists, since the row sitting in that
 * tenant's `menus` table won't otherwise pick it up.
 */

function parseTenantArg(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--tenant=")) {
      return arg.slice("--tenant=".length);
    }
  }
  throw new Error("resync-menu-tree requires --tenant=<slug>");
}

async function main(): Promise<void> {
  const slug = parseTenantArg(process.argv.slice(2));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant || tenant.status !== "active") {
    throw new Error(`No active tenant found for slug "${slug}"`);
  }

  const companyRows = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(companies));
  if (companyRows.length === 0) {
    throw new Error(`Tenant "${slug}" has no company - provision it first`);
  }

  for (const company of companyRows) {
    const [adminUser] = await withTenantSchema(tenant.schemaName, (tx) =>
      tx.select().from(users).where(eq(users.companyId, company.id)).limit(1),
    );
    if (!adminUser) {
      console.log(`  skipping company ${company.id} - no users`);
      continue;
    }
    await seedDefaultMenuTree({ schemaName: tenant.schemaName, companyId: company.id, createdBy: adminUser.id });
    console.log(`  resynced menu tree for company ${company.id}`);
  }

  console.log("\nDone.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });
