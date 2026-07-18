import { getRequestContext } from "../../common/context/request-context.js";
import type { TenantTx } from "../../database/get-db.js";
import { auditLogs } from "../../database/tenant/schema.js";

export interface AuditLogInput {
  companyId?: string;
  entity: string;
  entityId: string;
  action: string;
  /** Full row snapshots, not a pre-computed diff - insertAuditLog computes the diff itself (see computeDiff). Omit `before` for a create, `after` for a delete. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  changedBy?: string;
}

/**
 * Keeps only the keys that actually changed - an unbounded number of
 * unrelated columns on a wide row shouldn't make every edit's audit entry
 * repeat the entire row twice. `before`/`after` in the return value line up
 * key-for-key: any key present in one is present in the other, even if one
 * side's value is `undefined` (a key that didn't exist before, or was
 * removed after).
 */
export function computeDiff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): { before: Record<string, unknown> | undefined; after: Record<string, unknown> | undefined } {
  if (!before || !after) {
    return { before, after };
  }

  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }

  return { before: changedBefore, after: changedAfter };
}

/**
 * Takes `tx` directly rather than opening its own transaction (unlike
 * core/rbac/mutations.ts) precisely so it can be called as the last
 * statement of an existing business transaction (CLAUDE.md rule 6: "audit
 * writes happen inside the business transaction" - an audit log that could
 * diverge from the data it describes, e.g. via a separate commit, is worse
 * than none). request_id/ip/user_agent are read from the ambient request
 * context (set once by request-context.middleware.ts) rather than passed
 * by every caller - the alternative is every single call site in the
 * codebase remembering to thread three values through that have nothing to
 * do with the business operation they're auditing.
 *
 * Deliberately does NOT ensure this month's partition exists here:
 * `tx` runs as hyperion_app (get-db.ts), which only has USAGE on the
 * tenant schema, not CREATE - it cannot create a new partition table, and
 * granting it CREATE so it could would mean it OWNS whatever partition it
 * creates, which would carry full owner privileges (including UPDATE/
 * DELETE) that no REVOKE issued to a non-owner role can touch - defeating
 * this whole feature for that partition. Partition maintenance
 * (migration-runner.ts's ensureAuditLogPartitions) runs via the admin
 * connection instead, pre-creating several months at tenant-creation time
 * and topping up on every subsequent migration run. A write that falls
 * outside the currently-maintained range lands in audit_logs_default -
 * still fully correct, just not yet split into its own partition.
 */
export async function insertAuditLog(tx: TenantTx, input: AuditLogInput): Promise<void> {
  const ctx = getRequestContext();
  const { before, after } = computeDiff(input.before, input.after);

  await tx.insert(auditLogs).values({
    ...(input.companyId ? { companyId: input.companyId } : {}),
    entity: input.entity,
    entityId: input.entityId,
    action: input.action,
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
    ...(input.changedBy ? { changedBy: input.changedBy } : {}),
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.ip ? { ip: ctx.ip } : {}),
    ...(ctx?.userAgent ? { userAgent: ctx.userAgent } : {}),
  });
}
