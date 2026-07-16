import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll } from "vitest";
import { runMigrations } from "../../src/database/migration-runner.js";
import * as platformSchema from "../../src/database/platform/schema.js";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../src/database/platform/migrations", import.meta.url),
);
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

type PlatformDb = NodePgDatabase<typeof platformSchema>;

/** One-line Testcontainers harness: real Postgres per suite, migrated once, truncated between tests. */
export function useTestDatabase(): { db: PlatformDb } {
  let container: StartedPostgreSqlContainer | undefined;
  let pool: Pool | undefined;
  let db: PlatformDb;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17").start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    db = drizzle({ client: pool, schema: platformSchema });
    await runMigrations(db, MIGRATIONS_FOLDER);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterEach(async () => {
    await db.execute(sql`
      truncate table
        "platform"."tenant_modules",
        "platform"."platform_admins",
        "platform"."tenants"
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  return {
    get db(): PlatformDb {
      return db;
    },
  };
}
