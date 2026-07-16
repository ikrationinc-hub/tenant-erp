import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "../config/db.js";
import { logger } from "../config/logger.js";
import { withTenantSchemaAdmin } from "./get-db.js";
import { tenants } from "./platform/schema.js";

/**
 * `migrationsSchema` matters more than it looks: drizzle's migrator tracks
 * applied migrations in `<migrationsSchema>.__drizzle_migrations`, always
 * schema-qualified explicitly rather than resolved relative to the current
 * connection, defaulting to a single shared "drizzle" schema. For a
 * migration re-run against many tenant schemas with identical migration
 * files, that default would make every tenant after the first look "already
 * migrated" and silently skip - pass the tenant's own schema name here so
 * each tenant tracks its own migrations independently (this also keeps
 * `pg_dump -n tenant_x` self-contained per rule 9).
 *
 * Used for the platform schema only (a single, one-time migration target).
 * Tenant schemas go through applyPendingTenantMigrations/runTenantMigrations
 * below instead, which track applied versions in their own
 * `schema_migrations` table rather than drizzle's built-in bookkeeping - see
 * docs/adr/0003-cross-tenant-migration-runner.md for why.
 */
export async function runMigrations<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  migrationsFolder: string,
  migrationsSchema?: string,
): Promise<void> {
  await migrate(db, { migrationsFolder, ...(migrationsSchema ? { migrationsSchema } : {}) });
}

// --- Cross-tenant migration runner -----------------------------------------

const TENANT_MIGRATIONS_FOLDER = fileURLToPath(new URL("./tenant/migrations", import.meta.url));
const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";

export interface TenantMigrationFile {
  /** Journal tag, e.g. "0000_mysterious_blindfold" - used as the stable id. */
  version: string;
  statements: string[];
}

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

function readTenantMigrationFiles(): TenantMigrationFile[] {
  const journalPath = `${TENANT_MIGRATIONS_FOLDER}/meta/_journal.json`;
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;

  return journal.entries
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sqlPath = `${TENANT_MIGRATIONS_FOLDER}/${entry.tag}.sql`;
      const raw = readFileSync(sqlPath, "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
      return { version: entry.tag, statements };
    });
}

/**
 * Applies whichever `migrationFiles` are not yet recorded in this schema's
 * OWN `schema_migrations` table, all inside a single transaction: either
 * every pending migration for this schema applies, or none do. `adminDb`
 * must already be scoped to the target schema (see withTenantSchemaAdmin) -
 * this function does not touch connection/session scoping itself.
 */
async function applyPendingMigrationsWithDb(
  adminDb: NodePgDatabase<Record<string, never>>,
  migrationFiles: TenantMigrationFile[],
): Promise<string[]> {
  await adminDb.execute(sql`
    create table if not exists ${sql.identifier(SCHEMA_MIGRATIONS_TABLE)} (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const appliedRows = await adminDb.execute<{ version: string }>(
    sql`select version from ${sql.identifier(SCHEMA_MIGRATIONS_TABLE)}`,
  );
  const alreadyApplied = new Set(appliedRows.rows.map((row) => row.version));
  const pending = migrationFiles.filter((file) => !alreadyApplied.has(file.version));

  if (pending.length === 0) {
    return [];
  }

  await adminDb.transaction(async (tx) => {
    for (const file of pending) {
      for (const statement of file.statements) {
        await tx.execute(sql.raw(statement));
      }
      await tx.execute(
        sql`insert into ${sql.identifier(SCHEMA_MIGRATIONS_TABLE)} (version) values (${file.version})`,
      );
    }
  });

  return pending.map((file) => file.version);
}

/**
 * Applies pending tenant migrations to exactly one schema. Used both by the
 * provisioner (a brand-new schema, where every migration is "pending") and
 * by runTenantMigrations below (an existing schema, where most runs are a
 * no-op) - there is exactly one mechanism for "make this tenant schema
 * match the migration files," not two.
 */
export async function applyPendingTenantMigrations(
  schemaName: string,
  migrationFiles: TenantMigrationFile[] = readTenantMigrationFiles(),
): Promise<string[]> {
  return withTenantSchemaAdmin(schemaName, (adminDb) =>
    applyPendingMigrationsWithDb(adminDb, migrationFiles),
  );
}

export type TenantMigrationStatus = "up-to-date" | "migrated" | "failed";

export interface TenantMigrationResult {
  slug: string;
  schemaName: string;
  status: TenantMigrationStatus;
  appliedVersions: string[];
  error?: string;
}

export interface TenantMigrationReport {
  results: TenantMigrationResult[];
  success: boolean;
}

async function listActiveTenants(
  onlySlugs?: string[],
): Promise<Array<{ slug: string; schemaName: string }>> {
  const whereClause =
    onlySlugs && onlySlugs.length > 0
      ? and(eq(tenants.status, "active"), inArray(tenants.slug, onlySlugs))
      : eq(tenants.status, "active");

  const rows = await db
    .select({ slug: tenants.slug, schemaName: tenants.schemaName })
    .from(tenants)
    .where(whereClause);

  if (onlySlugs && onlySlugs.length > 0) {
    const found = new Set(rows.map((row) => row.slug));
    const missing = onlySlugs.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      throw new Error(`No active tenant found with slug(s): ${missing.join(", ")}`);
    }
  }

  return rows;
}

/**
 * Deploy-step entrypoint: applies pending tenant migrations to every active
 * tenant (or just `tenantSlug`, if given). Each schema is fully independent:
 * one schema failing rolls back only that schema's transaction and is
 * reported as "failed" - it does not stop or roll back any other schema.
 * Never call this from app boot: N running instances must not race to
 * migrate the same schemas concurrently.
 *
 * `migrationFiles` is only ever overridden by tests, to exercise a
 * deliberately-failing migration without writing to the real migrations
 * folder on disk. `tenantSlugs` accepts a list (the CLI only ever passes at
 * most one, via `--tenant=<slug>`) so tests can scope a run to a known set
 * of tenants without also picking up unrelated tenants left behind by other
 * test files sharing the same database.
 */
export async function runTenantMigrations(
  options: { tenantSlugs?: string[]; migrationFiles?: TenantMigrationFile[] } = {},
): Promise<TenantMigrationReport> {
  const migrationFiles = options.migrationFiles ?? readTenantMigrationFiles();
  const tenantsToMigrate = await listActiveTenants(options.tenantSlugs);

  logger.info(
    { tenantCount: tenantsToMigrate.length, migrationCount: migrationFiles.length },
    "starting tenant migration run",
  );

  const results: TenantMigrationResult[] = [];

  for (const tenant of tenantsToMigrate) {
    logger.info({ tenant: tenant.slug, schema: tenant.schemaName }, "applying tenant migrations");
    try {
      const appliedVersions = await applyPendingTenantMigrations(tenant.schemaName, migrationFiles);
      const status: TenantMigrationStatus = appliedVersions.length > 0 ? "migrated" : "up-to-date";
      results.push({ slug: tenant.slug, schemaName: tenant.schemaName, status, appliedVersions });
      logger.info(
        { tenant: tenant.slug, schema: tenant.schemaName, status, appliedVersions },
        "tenant migration result",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        slug: tenant.slug,
        schemaName: tenant.schemaName,
        status: "failed",
        appliedVersions: [],
        error: message,
      });
      logger.error(
        { tenant: tenant.slug, schema: tenant.schemaName, err: error },
        "tenant migration failed - this schema rolled back, continuing with remaining tenants",
      );
    }
  }

  const success = results.every((result) => result.status !== "failed");

  logger.info(
    {
      total: results.length,
      migrated: results.filter((r) => r.status === "migrated").length,
      upToDate: results.filter((r) => r.status === "up-to-date").length,
      failed: results.filter((r) => r.status === "failed").length,
      success,
    },
    "tenant migration run complete",
  );

  return { results, success };
}
