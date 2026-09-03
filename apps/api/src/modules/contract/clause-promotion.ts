import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import {
  findActiveVersion,
  findDueApprovedVersions,
  updateClauseVersion,
  type ClauseVersionRow,
} from "./clauses.repository.js";

/**
 * THE promotion transaction (docs/CONTRACT-MODULE-BUILD.md C-1 items 4-5):
 * flips the clause's prior 'active' version to 'superseded' (stamping its
 * effectiveTo to the new version's effectiveFrom) and the given version to
 * 'active', atomically. Both writes happen on the SAME `tx` the caller
 * already has open - this function never opens its own transaction, same
 * convention as nextNumber/insertAuditLog, so a promotion that fails
 * halfway never leaves two versions active or an orphaned effectiveTo.
 *
 * Called from two places with the same guarantee needed either way: the
 * BullMQ scheduler (proactive, tenant-by-tenant) and the on-access fallback
 * (reactive, the instant anyone reads a clause whose due version the
 * scheduler hasn't reached yet) - see promoteDueVersionsForClause below.
 */
export async function promoteVersion(tx: TenantTx, companyId: string, versionToPromote: ClauseVersionRow): Promise<void> {
  const priorActive = await findActiveVersion(tx, companyId, versionToPromote.clauseId);

  if (priorActive) {
    if (priorActive.id === versionToPromote.id) {
      return;
    }
    await updateClauseVersion(tx, priorActive.id, {
      status: "superseded",
      effectiveTo: versionToPromote.effectiveFrom,
      updatedAt: new Date(),
    });
    await insertAuditLog(tx, {
      companyId,
      entity: "clause_version",
      entityId: priorActive.id,
      action: "clause_version.superseded",
      before: { status: priorActive.status },
      after: { status: "superseded", effectiveTo: versionToPromote.effectiveFrom },
    });
  }

  await updateClauseVersion(tx, versionToPromote.id, { status: "active", updatedAt: new Date() });
  await insertAuditLog(tx, {
    companyId,
    entity: "clause_version",
    entityId: versionToPromote.id,
    action: "clause_version.promoted",
    before: { status: versionToPromote.status },
    after: { status: "active" },
  });
}

/**
 * The on-access fallback (C-1 item 5): promotes every due version across
 * every company in this tenant schema, then proceeds with the read that
 * triggered it. Cheap and idempotent - findDueApprovedVersions returns
 * nothing once nothing is due, so a read that arrives seconds after the
 * scheduler already promoted everything does one extra SELECT and nothing
 * else. Never throws on a version whose clause belongs to a different
 * company than the one reading right now - promotion is tenant-schema-wide
 * by design (the scheduler has no per-request company context at all), but
 * insertAuditLog needs SOME companyId, so this passes the version's own
 * clause's companyId, not the reading request's.
 */
export async function promoteDueVersions(tx: TenantTx, asOf: Date = new Date()): Promise<number> {
  const due = await findDueApprovedVersions(tx, asOf);
  for (const version of due) {
    await promoteVersion(tx, version.companyId, version);
  }
  return due.length;
}
