import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as platformSchema from "./platform-schema.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

/** Worker-local mirror of apps/api/src/config/db.ts - uses DATABASE_URL (the platform-schema superuser role), same as apps/api's own db.ts, since platform-schema reads don't go through the tenant-scoped hyperion_app pool. */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "unexpected error on idle platform postgres client");
});

export const db: NodePgDatabase<typeof platformSchema> = drizzle({ client: pool, schema: platformSchema });

export async function closePlatformDbPool(): Promise<void> {
  await pool.end();
}
