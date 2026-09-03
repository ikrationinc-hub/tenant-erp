import { and, eq, lte } from "drizzle-orm";
import type { TenantTx } from "./database/get-tenant-db.js";
import { auditLogs, clauseVersions } from "./database/tenant-schema.js";

type ClauseVersionRow = typeof clauseVersions.$inferSelect;

/**
 * Mirrors apps/api/src/modules/contract/clause-promotion.ts's promotion
 * transaction exactly (same flip-prior-to-superseded + stamp effectiveTo +
 * promote-to-active shape, same audit-in-the-same-transaction discipline),
 * against the worker's own tenant-schema mirror. This is the ONLY place in
 * apps/worker that writes clause_versions - apps/api's own on-access
 * fallback (clauses.service.ts's list/getVersions) is a separate,
 * independent code path that happens to do the identical thing reactively;
 * both are safe to run concurrently since the promotion is idempotent
 * (findActiveVersion returning the version already being promoted is a
 * no-op, see the `priorActive.id === versionToPromote.id` guard).
 */
async function findActiveVersion(tx: TenantTx, companyId: string, clauseId: string): Promise<ClauseVersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(clauseVersions)
    .where(and(eq(clauseVersions.clauseId, clauseId), eq(clauseVersions.companyId, companyId), eq(clauseVersions.status, "active")))
    .limit(1);
  return row;
}

async function promoteVersion(tx: TenantTx, companyId: string, versionToPromote: ClauseVersionRow): Promise<void> {
  const priorActive = await findActiveVersion(tx, companyId, versionToPromote.clauseId);

  if (priorActive) {
    if (priorActive.id === versionToPromote.id) {
      return;
    }
    await tx
      .update(clauseVersions)
      .set({ status: "superseded", effectiveTo: versionToPromote.effectiveFrom, updatedAt: new Date() })
      .where(eq(clauseVersions.id, priorActive.id));
    await tx.insert(auditLogs).values({
      companyId,
      entity: "clause_version",
      entityId: priorActive.id,
      action: "clause_version.superseded",
      before: { status: priorActive.status },
      after: { status: "superseded", effectiveTo: versionToPromote.effectiveFrom },
    });
  }

  await tx.update(clauseVersions).set({ status: "active", updatedAt: new Date() }).where(eq(clauseVersions.id, versionToPromote.id));
  await tx.insert(auditLogs).values({
    companyId,
    entity: "clause_version",
    entityId: versionToPromote.id,
    action: "clause_version.promoted",
    before: { status: versionToPromote.status },
    after: { status: "active" },
  });
}

/** Promotes every 'approved' version across every company in this tenant schema whose effectiveFrom has arrived. Returns how many were promoted, purely for job-completion logging. */
export async function promoteDueVersionsInSchema(tx: TenantTx, asOf: Date = new Date()): Promise<number> {
  const asOfDateString = asOf.toISOString().slice(0, 10);
  const due = await tx
    .select()
    .from(clauseVersions)
    .where(and(eq(clauseVersions.status, "approved"), lte(clauseVersions.effectiveFrom, asOfDateString)));

  for (const version of due) {
    await promoteVersion(tx, version.companyId, version);
  }
  return due.length;
}
