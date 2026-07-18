import { Client, Pool, type PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as tenantSchema from "./tenant/schema.js";
import { assertValidTenantSchemaName } from "./tenant/schema-name.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { RequestContext } from "../common/context/request-context.js";

/**
 * THE tenant boundary (CLAUDE.md rule 3). search_path is set and reset ONLY
 * in this file - nowhere else in the codebase is allowed to touch it
 * (enforced by scripts/check-search-path-boundary.mjs, wired into `pnpm lint`).
 *
 * `withTenantDb` is the only shape callers ever see. Today it acquires from
 * one shared pool; swapping that for a per-tenant pool (or a pool factory
 * keyed by tenant) later only changes the private `pool` below - the public
 * signature does not change.
 */

type TenantSchema = typeof tenantSchema;
type TenantDb = NodePgDatabase<TenantSchema>;
export type TenantTx = Parameters<TenantDb["transaction"]>[0] extends (
  tx: infer Tx,
) => Promise<unknown>
  ? Tx
  : never;

/**
 * Every normal business query goes through this pool, connected as
 * DATABASE_APP_URL's role (hyperion_app) - NOT DATABASE_URL's superuser.
 * This is what makes core/audit's REVOKE UPDATE/DELETE on audit_logs mean
 * anything: a superuser bypasses every ACL check, so the connection this
 * app actually queries through must not be one. withTenantSchemaAdmin
 * below (migrations, tenant provisioning) deliberately keeps using
 * DATABASE_URL's superuser instead, since creating schemas/tables/roles/
 * grants needs the elevated role. See docs/adr/0007-numbering-and-audit.md.
 */
const pool = new Pool({
  connectionString: env.DATABASE_APP_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "unexpected error on idle tenant postgres client");
});

/**
 * Runs `fn` inside a transaction on `client` with search_path scoped to
 * `tenantSchemaName` for that transaction only.
 *
 * set_config's second argument is a genuine bound parameter - never a
 * string-interpolated SQL fragment - and the schema name is validated
 * before use. The third argument (`true` = is_local) is what makes this
 * equivalent to SET LOCAL: Postgres resets it automatically at COMMIT or
 * ROLLBACK, so a pooled connection can never carry it into its next use.
 */
async function runInTenantTransaction<T>(
  client: PoolClient | Client,
  tenantSchemaName: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const validatedSchema = assertValidTenantSchemaName(tenantSchemaName);
  const tenantDb = drizzle({ client, schema: tenantSchema });

  return tenantDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('search_path', ${`${validatedSchema}, public`}, true)`);
    return fn(tx);
  });
}

/**
 * Same guarantee as withTenantDb, keyed directly by schema name instead of a
 * RequestContext. Exists for call sites that legitimately don't have a
 * resolved RequestContext yet - chiefly login, which is what produces the
 * JWT a RequestContext's tenantScope would otherwise come from. Prefer
 * withTenantDb wherever a RequestContext is already available.
 */
export async function withTenantSchema<T>(
  tenantSchemaName: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await runInTenantTransaction(client, tenantSchemaName, fn);
  } finally {
    client.release();
  }
}

export async function withTenantDb<T>(
  ctx: RequestContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantScope) {
    throw new Error("withTenantDb called without a resolved tenant scope");
  }

  return withTenantSchema(ctx.tenantScope.tenantSchema, fn);
}

/**
 * Admin/provisioning path: creates the schema if missing, then hands back a
 * drizzle instance whose session (not just one transaction) is scoped to it
 * for the duration of `fn` - e.g. to run tenant migrations, whose unqualified
 * CREATE TABLE statements must land in that one schema.
 *
 * This uses a dedicated one-off Client (never the pool above), so a
 * session-level (non-local) set_config is safe here: the connection is
 * closed, never released back to a pool, so there is no "next request" for
 * it to leak into.
 */
export async function withTenantSchemaAdmin<T>(
  tenantSchemaName: string,
  fn: (adminDb: NodePgDatabase<Record<string, never>>) => Promise<T>,
): Promise<T> {
  const validatedSchema = assertValidTenantSchemaName(tenantSchemaName);
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const adminDb = drizzle({ client });
    await adminDb.execute(sql`create schema if not exists ${sql.identifier(validatedSchema)}`);
    await adminDb.execute(
      sql`select set_config('search_path', ${`${validatedSchema}, public`}, false)`,
    );
    return await fn(adminDb);
  } finally {
    await client.end();
  }
}

export async function closeTenantDbPool(): Promise<void> {
  await pool.end();
}

// --- Test-only surface ------------------------------------------------------
// Exists solely so tenant-isolation.test.ts can prove a pooled connection's
// session config resets when a transaction ends (commit OR rollback), BEFORE
// the connection is released back to the pool. It calls the exact same
// runInTenantTransaction helper withTenantDb uses - this observes that code
// path, it does not duplicate or bypass it.
export async function withTenantDbObservingSessionAfter<T>(
  tenantSchemaName: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<{
  outcome: { ok: true; value: T } | { ok: false; error: unknown };
  sessionScopeAfter: string;
}> {
  const client = await pool.connect();
  try {
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      const value = await runInTenantTransaction(client, tenantSchemaName, fn);
      outcome = { ok: true, value };
    } catch (error) {
      outcome = { ok: false, error };
    }

    const check = await client.query<{ scope: string }>(
      "select current_setting('search_path', true) as scope",
    );
    const sessionScopeAfter = check.rows[0]?.scope ?? "";

    return { outcome, sessionScopeAfter };
  } finally {
    client.release();
  }
}
