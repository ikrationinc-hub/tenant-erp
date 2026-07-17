import type { TenantTx } from "../../database/get-db.js";
import { auditLogs } from "../../database/tenant/schema.js";

export interface AuditLogInput {
  companyId: string;
  actorId: string;
  entity: string;
  entityId: string;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * Takes `tx` directly rather than opening its own transaction (unlike
 * core/rbac/mutations.ts) precisely so it can be called as the last
 * statement of an existing business transaction (CLAUDE.md rule 6: "audit
 * writes happen inside the business transaction" - an audit log that could
 * diverge from the data it describes, e.g. via a separate commit, is worse
 * than none).
 */
export async function insertAuditLog(tx: TenantTx, input: AuditLogInput): Promise<void> {
  await tx.insert(auditLogs).values({
    companyId: input.companyId,
    actorId: input.actorId,
    entity: input.entity,
    entityId: input.entityId,
    action: input.action,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}
