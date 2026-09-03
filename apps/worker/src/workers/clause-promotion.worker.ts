import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import { CLAUSE_PROMOTION_QUEUE_NAME } from "../queues/clause-promotion.queue.js";
import { promoteDueVersionsInSchema } from "../clause-promotion.js";
import { db } from "../database/get-platform-db.js";
import { tenants } from "../database/platform-schema.js";
import { withTenantSchema } from "../database/get-tenant-db.js";
import { logger } from "../config/logger.js";

/**
 * docs/CONTRACT-MODULE-BUILD.md C-1 item 5: the BullMQ scheduled job that
 * promotes any Approved clause version whose effective_from has arrived to
 * Active. Loops every ACTIVE tenant's own schema (mirroring apps/api/
 * scripts/migrate-tenants.ts's own tenant loop) - clause_versions is
 * tenant-scoped, so there is no single cross-tenant query to run (rule 4).
 * A failure promoting one tenant is logged and the loop continues to the
 * next rather than aborting the whole job - one tenant's bad data (or a
 * transient connection issue) should never block every other tenant's
 * on-time promotion.
 */
export function createClausePromotionWorker(connection: Redis): Worker {
  const worker = new Worker(
    CLAUSE_PROMOTION_QUEUE_NAME,
    async () => {
      const activeTenants = await db.select().from(tenants).where(eq(tenants.status, "active"));
      let totalPromoted = 0;

      for (const tenant of activeTenants) {
        try {
          const promoted = await withTenantSchema(tenant.schemaName, (tx) => promoteDueVersionsInSchema(tx));
          totalPromoted += promoted;
          if (promoted > 0) {
            logger.info({ tenant: tenant.slug, schema: tenant.schemaName, promoted }, "clause versions promoted");
          }
        } catch (err) {
          logger.error({ err, tenant: tenant.slug, schema: tenant.schemaName }, "clause promotion failed for tenant");
        }
      }

      return { tenantsChecked: activeTenants.length, totalPromoted };
    },
    { connection },
  );

  worker.on("completed", (job, result: { tenantsChecked: number; totalPromoted: number }) => {
    logger.info({ jobId: job.id, ...result }, "clause promotion job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "clause promotion job failed");
  });

  return worker;
}
