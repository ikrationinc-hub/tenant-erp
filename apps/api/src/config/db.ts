import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as platformSchema from "../database/platform/schema.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "unexpected error on idle postgres client");
});

export const db: NodePgDatabase<typeof platformSchema> = drizzle({
  client: pool,
  schema: platformSchema,
});

export async function closeDbPool(): Promise<void> {
  await pool.end();
}

export interface DbPoolStats {
  total: number;
  idle: number;
  waiting: number;
}

/** Read by GET /api/v1/platform/health (ADM-5) - a real round-trip query, not just "the pool object exists", so a reachable-but-wedged Postgres still reports unreachable. */
export async function checkDbHealth(): Promise<{ reachable: boolean; pool: DbPoolStats }> {
  const poolStats: DbPoolStats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
  try {
    await db.execute(sql`select 1`);
    return { reachable: true, pool: poolStats };
  } catch (err) {
    logger.error({ err }, "postgres health check failed");
    return { reachable: false, pool: poolStats };
  }
}
