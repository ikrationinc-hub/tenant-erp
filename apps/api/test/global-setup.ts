import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

// Runs once, before any test file's module graph loads, so process.env is
// already correct by the time src/config/env.ts (and anything that imports
// it) is first evaluated. Must NOT import ANY src/ module here, even
// indirectly - src/database/migration-runner.ts, for example, now imports
// src/config/db.ts (for listActiveTenants), which imports env.ts, which
// would evaluate (and fail) before DATABASE_URL below is set. Only bare
// libraries (pg, drizzle-orm, testcontainers) are safe to import statically
// in this file.

const PLATFORM_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../src/database/platform/migrations", import.meta.url),
);

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer("postgres:17").start();

  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.REDIS_URL ??= "redis://localhost:6380";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-at-least-32-characters-long";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-at-least-32-characters-long";
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_REGION ??= "us-east-1";
  process.env.S3_ACCESS_KEY_ID ??= "test";
  process.env.S3_SECRET_ACCESS_KEY ??= "test";
  process.env.S3_BUCKET ??= "hyperion-erp-test";
  process.env.SMTP_HOST ??= "localhost";
  process.env.SMTP_PORT ??= "1025";

  // Every test that goes through config/db.ts or get-db.ts needs the
  // platform schema to already exist (createTenantSchema inserts into
  // platform.tenants). Apply it once, here, against this fresh container.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const migrationDb = drizzle({ client });
    await migrate(migrationDb, { migrationsFolder: PLATFORM_MIGRATIONS_FOLDER });
  } finally {
    await client.end();
  }
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
