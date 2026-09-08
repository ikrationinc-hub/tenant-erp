import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { SALES_DASHBOARD_REFRESH_QUEUE_NAME } from "../queues/sales-dashboard-refresh.queue.js";
import { periodMonthOf, refreshSalesDashboardForTenant } from "../sales-dashboard-refresh.js";
import { db } from "../database/get-platform-db.js";
import { tenants } from "../database/platform-schema.js";
import { withTenantSchema } from "../database/get-tenant-db.js";
import { logger } from "../config/logger.js";

/**
 * S-6 (docs/SALES-MODULE-PLAN.md): the BullMQ scheduled job that
 * recomputes the current month's sales-dashboard cache tables for every
 * company in every active tenant. Mirrors clause-promotion.worker.ts's
 * own tenant-loop shape exactly: sales_dashboard_snapshots (and its three
 * breakdown tables) are tenant-scoped, so there is no single cross-tenant
 * query to run (rule 4). A failure refreshing one tenant is logged and
 * the loop continues to the next rather than aborting the whole job -
 * one tenant's bad data (or a transient connection issue) should never
 * block every other tenant's dashboard from refreshing.
 */
export function createSalesDashboardRefreshWorker(connection: Redis): Worker {
  const worker = new Worker(
    SALES_DASHBOARD_REFRESH_QUEUE_NAME,
    async () => {
      const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
      const periodMonth = periodMonthOf(new Date());
      let tenantsRefreshed = 0;

      for (const tenant of activeTenants) {
        try {
          await withTenantSchema(tenant.schemaName, (tx) => refreshSalesDashboardForTenant(tx, periodMonth));
          tenantsRefreshed += 1;
        } catch (err) {
          logger.error({ err, tenant: tenant.slug, schema: tenant.schemaName }, "sales dashboard refresh failed for tenant");
        }
      }

      return { tenantsChecked: activeTenants.length, tenantsRefreshed, periodMonth };
    },
    { connection },
  );

  worker.on("completed", (job, result: { tenantsChecked: number; tenantsRefreshed: number; periodMonth: string }) => {
    logger.info({ jobId: job.id, ...result }, "sales dashboard refresh job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "sales dashboard refresh job failed");
  });

  return worker;
}
