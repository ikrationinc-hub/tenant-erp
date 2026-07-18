import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { withTenantSchemaAdmin } from "./get-db.js";
import { tenants } from "./platform/schema.js";

/**
 * The role every normal business query connects as (get-db.ts's pool via
 * DATABASE_APP_URL) - deliberately NOT a superuser, so that
 * core/audit/write.ts's REVOKE UPDATE/DELETE on audit_logs actually means
 * something. Idempotent and re-asserted on every tenant migration run
 * (including a no-pending-migrations no-op), so both a brand-new schema and
 * one that existed before this feature end up with correct grants. See
 * docs/adr/0007-numbering-and-audit.md.
 */
const APP_DB_ROLE = "hyperion_app";

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Runs after every tenant migration attempt for `schemaName`, whether or
 * not anything was actually pending - so an already-migrated tenant from
 * before this feature existed still ends up with correct grants. Uses
 * `adminDb` (DATABASE_URL's superuser) since granting/revoking privileges
 * requires the elevated role; APP_DB_ROLE itself never needs these rights.
 */
async function ensureAppRoleGrants(
  adminDb: NodePgDatabase<Record<string, never>>,
  schemaName: string,
): Promise<void> {
  const appPassword = new URL(env.DATABASE_APP_URL).password;
  const escapedPassword = escapeSqlLiteral(appPassword);

  // Exception-based, not check-then-create: tenant migrations for
  // different schemas can run concurrently (parallel test files, or
  // multiple tenants provisioning at once), and a plain "IF NOT EXISTS"
  // SELECT-then-CREATE has a race window two concurrent sessions can both
  // pass through before either commits. Catching the exception here is
  // atomic - Postgres raises it from the CREATE ROLE itself, not from a
  // separate check, so there's no window for two sessions to both think
  // the role is missing. Two concurrent CREATE ROLEs racing on the same
  // name were observed (empirically, not just in theory - this is what a
  // parallel test run's flakiness traced back to) to raise
  // unique_violation on pg_authid's own unique index, not
  // duplicate_object - CREATE ROLE apparently doesn't go through the same
  // higher-level "already exists" check CREATE SCHEMA/CREATE TABLE do.
  // Catching both is what actually closes the race.
  await adminDb.execute(sql.raw(`
    DO $$
    BEGIN
      EXECUTE format('CREATE ROLE ${APP_DB_ROLE} LOGIN PASSWORD %L', '${escapedPassword}');
    EXCEPTION
      WHEN duplicate_object THEN
        NULL;
      WHEN unique_violation THEN
        NULL;
    END
    $$;
  `));

  const schemaIdent = sql.identifier(schemaName);
  const roleIdent = sql.identifier(APP_DB_ROLE);

  await adminDb.execute(sql`GRANT USAGE ON SCHEMA ${schemaIdent} TO ${roleIdent}`);
  await adminDb.execute(
    sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schemaIdent} TO ${roleIdent}`,
  );
  await adminDb.execute(
    sql`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schemaIdent} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleIdent}`,
  );

  // The one deliberate carve-out (CLAUDE.md rule 6, task: audit immutability):
  // the app role can INSERT and SELECT audit_logs, never UPDATE or DELETE it,
  // even though the blanket grant above just gave it exactly that.
  await adminDb.execute(sql`REVOKE UPDATE, DELETE ON audit_logs FROM ${roleIdent}`);
}

/**
 * Pre-creates audit_logs partitions for the surrounding `monthsAhead`
 * months (default: the month before, current, and two after). Runs on the
 * admin connection deliberately - see core/audit/write.ts's doc comment on
 * why hyperion_app cannot be granted CREATE and do this itself (it would
 * end up owning, and therefore able to UPDATE/DELETE, whatever partition it
 * creates). Idempotent (IF NOT EXISTS-guarded, catching duplicate_table),
 * so re-running this on every migration invocation is exactly what keeps
 * the scheme "self-sustaining forever" in practice: it only actually
 * creates something new once a calendar month rolls past what was already
 * covered.
 */
async function ensureAuditLogPartitions(
  adminDb: NodePgDatabase<Record<string, never>>,
  monthsAhead: readonly number[] = [-1, 0, 1, 2],
): Promise<void> {
  const now = new Date();

  for (const offset of monthsAhead) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
    const partitionName = `audit_logs_${monthStart.getUTCFullYear()}_${String(monthStart.getUTCMonth() + 1).padStart(2, "0")}`;

    await adminDb.execute(
      sql.raw(`
        DO $$
        BEGIN
          EXECUTE format(
            'CREATE TABLE %I PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
            '${partitionName}', '${monthStart.toISOString()}', '${monthEnd.toISOString()}'
          );
        EXCEPTION
          WHEN duplicate_table THEN
            NULL;
          WHEN unique_violation THEN
            NULL;
        END
        $$;
      `),
    );
  }
}

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
  schemaName: string,
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

  if (pending.length > 0) {
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
  }

  // Runs even when nothing was pending, deliberately outside the migration
  // transaction above: an already-migrated tenant from before this feature
  // existed still needs correct grants, and re-asserting idempotent
  // GRANT/REVOKE statements on every run is cheap and side-effect-free.
  await ensureAppRoleGrants(adminDb, schemaName);
  await ensureAuditLogPartitions(adminDb);

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
    applyPendingMigrationsWithDb(adminDb, schemaName, migrationFiles),
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
