import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDbPool, db } from "../../config/db.js";
import { closeTenantDbPool, withTenantSchemaAdmin } from "../get-db.js";
import {
  runTenantMigrations,
  type TenantMigrationFile,
  type TenantMigrationReport,
} from "../migration-runner.js";
import { tenants } from "../platform/schema.js";

const TEST_TIMEOUT_MS = 120_000;
// Every real tenant migration file that exists on disk, in order - kept as a
// list (not a single constant) because the auth task added a second one
// on top of the platform-schema task's first.
const REAL_MIGRATION_VERSIONS = [
  "0000_mysterious_blindfold",
  "0001_high_outlaw_kid",
  "0002_silent_white_tiger",
  "0003_narrow_moonstone",
  "0004_cute_purifiers",
  "0005_furry_kingpin",
  "0006_sad_trish_tilby",
  "0007_tiresome_blob",
  "0008_serious_karen_page",
  "0009_worried_big_bertha",
  "0010_modern_adam_warlock",
  "0011_chubby_blockbuster",
  "0012_dry_robbie_robertson",
  "0013_faulty_black_tarantula",
];
const CONFLICT_TABLE = "migration_runner_test_conflict";

interface TenantRef {
  slug: string;
  schemaName: string;
}

function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function insertActiveTenant(name: string, label: string): Promise<TenantRef> {
  const slug = uniqueSlug(label);
  const schemaName = `tenant_${slug.replace(/-/g, "_")}`;
  await db.insert(tenants).values({ name, slug, schemaName, status: "active" });
  return { slug, schemaName };
}

function resultFor(report: TenantMigrationReport, slug: string) {
  const result = report.results.find((r) => r.slug === slug);
  if (!result) {
    throw new Error(`no result for tenant ${slug}`);
  }
  return result;
}

describe("runTenantMigrations", () => {
  let alpha: TenantRef;
  let beta: TenantRef;
  let gamma: TenantRef;

  beforeAll(async () => {
    alpha = await insertActiveTenant("Alpha Co", "mr-alpha");
    beta = await insertActiveTenant("Beta Co", "mr-beta");
    gamma = await insertActiveTenant("Gamma Co", "mr-gamma");
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
  });

  const allSlugs = () => [alpha.slug, beta.slug, gamma.slug];

  it(
    "applies the real tenant migrations cleanly to all 3 schemas",
    async () => {
      const report = await runTenantMigrations({ tenantSlugs: allSlugs() });

      expect(report.success).toBe(true);
      expect(report.results).toHaveLength(3);

      for (const tenant of [alpha, beta, gamma]) {
        const result = resultFor(report, tenant.slug);
        expect(result.status).toBe("migrated");
        expect(result.appliedVersions).toEqual(REAL_MIGRATION_VERSIONS);
        expect(result.schemaName).toBe(tenant.schemaName);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is a no-op on re-run once every schema is up to date",
    async () => {
      const report = await runTenantMigrations({ tenantSlugs: allSlugs() });

      expect(report.success).toBe(true);
      for (const tenant of [alpha, beta, gamma]) {
        const result = resultFor(report, tenant.slug);
        expect(result.status).toBe("up-to-date");
        expect(result.appliedVersions).toEqual([]);
      }
    },
    TEST_TIMEOUT_MS,
  );

  describe("partial failure", () => {
    // Only the new, not-yet-applied version needs to be listed: pending-ness
    // is computed against schema_migrations, not against this array's
    // completeness, so the already-applied real migration doesn't need to
    // appear here too.
    const fakeMigrationFiles: TenantMigrationFile[] = [
      {
        version: "0001_test_conflict",
        statements: [`create table ${CONFLICT_TABLE} (id int)`],
      },
    ];

    beforeAll(async () => {
      // Seed beta only with a table that the new migration will also try to
      // create, so its transaction - and only its transaction - fails.
      await withTenantSchemaAdmin(beta.schemaName, async (adminDb) => {
        await adminDb.execute(sql.raw(`create table ${CONFLICT_TABLE} (id int)`));
      });
    }, TEST_TIMEOUT_MS);

    it(
      "rolls back the failing schema, commits the others, and reports each accurately",
      async () => {
        const report = await runTenantMigrations({
          tenantSlugs: allSlugs(),
          migrationFiles: fakeMigrationFiles,
        });

        expect(report.success).toBe(false);

        const alphaResult = resultFor(report, alpha.slug);
        expect(alphaResult.status).toBe("migrated");
        expect(alphaResult.appliedVersions).toEqual(["0001_test_conflict"]);

        const betaResult = resultFor(report, beta.slug);
        expect(betaResult.status).toBe("failed");
        expect(betaResult.appliedVersions).toEqual([]);
        expect(betaResult.error).toBeTruthy();
        expect(betaResult.error).toMatch(new RegExp(CONFLICT_TABLE));

        const gammaResult = resultFor(report, gamma.slug);
        expect(gammaResult.status).toBe("migrated");
        expect(gammaResult.appliedVersions).toEqual(["0001_test_conflict"]);

        // Beta's rollback must be real: the schema_migrations row for the
        // failed migration must not exist, even though its statement (the
        // CREATE TABLE) partially ran before failing... it didn't, since the
        // whole batch is one transaction - confirm no row was recorded.
        const betaMigrations = await withTenantSchemaAdmin(beta.schemaName, (adminDb) =>
          adminDb.execute<{ version: string }>(sql`select version from schema_migrations`),
        );
        expect(betaMigrations.rows.map((row) => row.version)).toEqual(REAL_MIGRATION_VERSIONS);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "retries only the previously-failed schema on the next run",
      async () => {
        const report = await runTenantMigrations({
          tenantSlugs: allSlugs(),
          migrationFiles: fakeMigrationFiles,
        });

        // Alpha and gamma already have 0001_test_conflict recorded - re-running
        // must not attempt it again.
        expect(resultFor(report, alpha.slug).status).toBe("up-to-date");
        expect(resultFor(report, alpha.slug).appliedVersions).toEqual([]);
        expect(resultFor(report, gamma.slug).status).toBe("up-to-date");
        expect(resultFor(report, gamma.slug).appliedVersions).toEqual([]);

        // Beta is still missing 0001_test_conflict, so it's retried - and
        // fails again identically, because the underlying conflict is still
        // there. Still non-zero exit / reported failure.
        expect(resultFor(report, beta.slug).status).toBe("failed");
        expect(report.success).toBe(false);

        // Now fix the underlying conflict and confirm the retry succeeds -
        // proving beta really was retried, not just permanently skipped.
        await withTenantSchemaAdmin(beta.schemaName, async (adminDb) => {
          await adminDb.execute(sql.raw(`drop table ${CONFLICT_TABLE}`));
        });

        const finalReport = await runTenantMigrations({
          tenantSlugs: allSlugs(),
          migrationFiles: fakeMigrationFiles,
        });

        expect(finalReport.success).toBe(true);
        expect(resultFor(finalReport, alpha.slug).status).toBe("up-to-date");
        expect(resultFor(finalReport, gamma.slug).status).toBe("up-to-date");
        expect(resultFor(finalReport, beta.slug).status).toBe("migrated");
        expect(resultFor(finalReport, beta.slug).appliedVersions).toEqual(["0001_test_conflict"]);
      },
      TEST_TIMEOUT_MS,
    );
  });
});
