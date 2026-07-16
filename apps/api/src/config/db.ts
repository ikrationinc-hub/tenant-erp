import { Pool } from "pg";
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
