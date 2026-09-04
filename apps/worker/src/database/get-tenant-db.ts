import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as tenantSchema from "./tenant-schema.js";
import { assertValidTenantSchemaName } from "./schema-name.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/**
 * Mirrors apps/api/src/database/get-db.ts's withTenantSchema exactly - same
 * SET LOCAL search_path (via set_config's third argument = true, i.e.
 * transaction-scoped, reset automatically at COMMIT/ROLLBACK) on the same
 * hyperion_app role (DATABASE_APP_URL), so a worker job gets the identical
 * tenant-isolation guarantee a request handler gets (CLAUDE.md rule 3: SET
 * LOCAL search_path, never SET, and this is the only file in apps/worker
 * allowed to touch it - mirroring get-db.ts's own "lives here only" rule).
 */

type TenantSchema = typeof tenantSchema;
type TenantDb = NodePgDatabase<TenantSchema>;
export type TenantTx = Parameters<TenantDb["transaction"]>[0] extends (tx: infer Tx) => Promise<unknown> ? Tx : never;

const pool = new Pool({
  connectionString: env.DATABASE_APP_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "unexpected error on idle tenant postgres client");
});

export async function withTenantSchema<T>(tenantSchemaName: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  const validatedSchema = assertValidTenantSchemaName(tenantSchemaName);
  const client = await pool.connect();
  try {
    const tenantDb = drizzle({ client, schema: tenantSchema });
    return await tenantDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('search_path', ${`${validatedSchema}, public`}, true)`);
      return fn(tx);
    });
  } finally {
    client.release();
  }
}

export async function closeTenantDbPool(): Promise<void> {
  await pool.end();
}
