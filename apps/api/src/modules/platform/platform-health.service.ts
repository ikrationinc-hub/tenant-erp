import { checkDbHealth, db } from "../../config/db.js";
import { checkRedisHealth, redis } from "../../config/redis.js";
import { getLatestTenantMigrationVersion, getTenantMigrationHealth } from "../../database/migration-runner.js";
import { tenants } from "../../database/platform/schema.js";

/** Duplicated from apps/worker/src/heartbeat.ts's WORKER_HEARTBEAT_KEY - no shared package between the two apps for a constant this small. Keep both in sync if it ever changes. */
const WORKER_HEARTBEAT_KEY = "platform:worker:heartbeat";

export interface PlatformHealthTenantStatus {
  id: string;
  slug: string;
  status: "provisioning" | "active" | "suspended";
  schemaPresent: boolean;
  lastMigrationVersion: string | undefined;
  upToDate: boolean;
}

export interface PlatformHealthResult {
  api: { status: "up"; version: string; uptimeSeconds: number };
  postgres: { reachable: boolean; pool: { total: number; idle: number; waiting: number } };
  redis: { reachable: boolean };
  worker: { reachable: boolean; lastHeartbeatAt: string | null };
  tenants: PlatformHealthTenantStatus[];
}

/**
 * Infrastructure health only (ADM-5 task item 4) - no business metrics, no
 * per-tenant row beyond schema/migration/status. Every per-tenant check runs
 * its own schema-qualified query (migration-runner.ts's
 * getTenantMigrationHealth), never a cross-tenant join.
 */
export async function getPlatformHealth(): Promise<PlatformHealthResult> {
  const [postgres, redisReachable, workerHeartbeat, tenantRows] = await Promise.all([
    checkDbHealth(),
    checkRedisHealth(),
    redis.get(WORKER_HEARTBEAT_KEY),
    db.select({ id: tenants.id, slug: tenants.slug, status: tenants.status, schemaName: tenants.schemaName }).from(
      tenants,
    ),
  ]);

  const latestVersion = getLatestTenantMigrationVersion();

  const tenantStatuses = await Promise.all(
    tenantRows.map(async (tenant): Promise<PlatformHealthTenantStatus> => {
      const migration = await getTenantMigrationHealth(tenant.schemaName);
      return {
        id: tenant.id,
        slug: tenant.slug,
        status: tenant.status,
        schemaPresent: migration.schemaPresent,
        lastMigrationVersion: migration.lastAppliedVersion,
        upToDate: migration.lastAppliedVersion === latestVersion,
      };
    }),
  );

  return {
    api: {
      status: "up",
      version: process.env.npm_package_version ?? "0.0.0",
      uptimeSeconds: Math.floor(process.uptime()),
    },
    postgres,
    redis: { reachable: redisReachable },
    worker: { reachable: workerHeartbeat !== null, lastHeartbeatAt: workerHeartbeat },
    tenants: tenantStatuses,
  };
}
