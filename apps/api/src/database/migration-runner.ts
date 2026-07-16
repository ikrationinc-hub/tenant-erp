import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

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
 */
export async function runMigrations<TSchema extends Record<string, unknown>>(
  db: NodePgDatabase<TSchema>,
  migrationsFolder: string,
  migrationsSchema?: string,
): Promise<void> {
  await migrate(db, { migrationsFolder, ...(migrationsSchema ? { migrationsSchema } : {}) });
}
