import { closeDbPool } from "../src/config/db.js";
import { closeRedis } from "../src/config/redis.js";
import { closeTenantDbPool } from "../src/database/get-db.js";
import { seedDevData } from "./seed-dev-core.js";

/**
 * `pnpm seed:dev --tenant=<slug>` - enough Supplier/Purchase data to
 * smoke-test FE-8's mocks-off default against a freshly provisioned
 * tenant, which is otherwise correctly (but uselessly, for a demo) empty.
 * NOT the full FE-7 week-15 demo script (realistic metals data, multiple
 * roles, etc.) - just one of each thing so every screen/panel has
 * something to render. Never run automatically - no call site anywhere in
 * provisioning imports this file. The actual seeding logic lives in
 * seed-dev-core.ts, reused as-is by this script's own idempotency test.
 */

function parseTenantArg(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--tenant=")) {
      return arg.slice("--tenant=".length);
    }
  }
  throw new Error("seed:dev requires --tenant=<slug>");
}

async function main(): Promise<void> {
  const slug = parseTenantArg(process.argv.slice(2));
  const result = await seedDevData(slug);
  console.log(`Suppliers ensured: ${result.supplierIds.length}`);
  console.log(`Draft purchase: ${result.draftPurchaseId}`);
  console.log(`Approved purchase: ${result.approvedPurchaseId}`);
  console.log(`Posted purchase: ${result.postedPurchaseId}`);
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
