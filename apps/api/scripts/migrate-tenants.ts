import { closeDbPool } from "../src/config/db.js";
import { logger } from "../src/config/logger.js";
import { runTenantMigrations } from "../src/database/migration-runner.js";

/**
 * Deploy-step CLI: `pnpm migrate:tenants` (all active tenants) or
 * `pnpm migrate:tenants --tenant=<slug>` (one). Never run this from app
 * boot - N running instances must not race to migrate the same schemas.
 */

function parseTenantArg(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--tenant=")) {
      return arg.slice("--tenant=".length);
    }
  }
  return undefined;
}

function printReport(report: Awaited<ReturnType<typeof runTenantMigrations>>): void {
  console.log("\nTenant migration report:");
  for (const result of report.results) {
    const detail =
      result.status === "failed"
        ? `FAILED - ${result.error ?? "unknown error"}`
        : result.status === "migrated"
          ? `migrated (${result.appliedVersions.join(", ")})`
          : "up-to-date";
    console.log(`  ${result.slug} (${result.schemaName}): ${detail}`);
  }
  console.log(`\n${report.success ? "OK" : "FAILED"}: ${report.results.length} tenant(s) processed\n`);
}

async function main(): Promise<void> {
  const tenantSlug = parseTenantArg(process.argv.slice(2));
  const report = await runTenantMigrations(tenantSlug ? { tenantSlugs: [tenantSlug] } : {});
  printReport(report);

  if (!report.success) {
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, "tenant migration run crashed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbPool();
  });
