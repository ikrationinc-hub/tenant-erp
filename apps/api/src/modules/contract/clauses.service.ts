import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb } from "../../database/get-db.js";
import { promoteDueVersions } from "./clause-promotion.js";
import {
  findClauseById,
  findClauseVersionById,
  findMaxVersionNumber,
  insertClause,
  insertClauseVersion,
  listClauses,
  listVersionsForClause,
  updateClauseFields,
  updateClauseVersion,
  type ClauseRow,
  type ClauseVersionRow,
  type ClausesListParams,
} from "./clauses.repository.js";
import type { AddClauseVersionInput, CreateClauseInput } from "./clauses.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** {{dotted.token}} - stored verbatim in clause_text, extracted here for the "list a version's tokens" endpoint (substitution itself is C-2's job). */
export function extractPlaceholderTokens(clauseText: string): string[] {
  const matches = clauseText.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g);
  const tokens = new Set<string>();
  for (const match of matches) {
    const token = match[1];
    if (token) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

export async function list(ctx: RequestContext, params: ClausesListParams): Promise<PaginatedRows<ClauseRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    await promoteDueVersions(tx);
    return listClauses(tx, scope.companyId, params);
  });
}

export async function getVersions(ctx: RequestContext, clauseId: string): Promise<ClauseVersionRow[]> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    await promoteDueVersions(tx);
    const clause = await findClauseById(tx, scope.companyId, clauseId);
    if (!clause) {
      throw new NotFoundError("Clause not found");
    }
    return listVersionsForClause(tx, scope.companyId, clauseId);
  });
}

export function getVersionTokens(version: ClauseVersionRow): string[] {
  return extractPlaceholderTokens(version.clauseText);
}

/**
 * A clause is created together with its first version (docs/CONTRACT-MODULE-
 * BUILD.md: clauses is stable identity, clause_versions is where text
 * actually lives - there is no such thing as a clause with zero versions).
 * The first version starts 'draft', same as every subsequent one added via
 * addVersion below - promotion to 'active' is always a separate, explicit
 * step (approve, then the scheduler/fallback promotes once effectiveFrom
 * arrives), never implicit at creation.
 */
export async function create(ctx: RequestContext, input: CreateClauseInput): Promise<{ clause: ClauseRow; version: ClauseVersionRow }> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const clauseCode = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "CLAUSE",
      date: new Date(),
    });

    const clause = await insertClause(tx, {
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      clauseCode,
      clauseTitle: input.clauseTitle,
      ...(input.divisionId ? { divisionId: input.divisionId } : {}),
      category: input.category,
      createdBy: scope.userId,
    });

    const version = await insertClauseVersion(tx, {
      companyId: scope.companyId,
      clauseId: clause.id,
      versionNumber: 1,
      clauseText: input.clauseText,
      effectiveFrom: input.effectiveFrom,
      changeReason: input.changeReason,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause",
      entityId: clause.id,
      action: "clause.created",
      after: { clauseCode: clause.clauseCode, clauseTitle: clause.clauseTitle, category: clause.category },
    });
    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause_version",
      entityId: version.id,
      action: "clause_version.created",
      after: { clauseId: clause.id, versionNumber: version.versionNumber, effectiveFrom: version.effectiveFrom },
    });

    return { clause, version };
  });
}

/**
 * Editing a clause's text is ALWAYS an insert (CLAUDE.md rule 8's spirit -
 * see clauseVersions' own doc comment in schema.ts). New version starts
 * 'draft'; effectiveFrom must be strictly AFTER every existing version's
 * own effectiveFrom for this clause - versions are a strictly chronological
 * timeline, so this is what "no overlapping/gapping effective windows"
 * (C-1 item 5) actually reduces to: as long as each new window starts after
 * the last one started, promoteVersion's own effectiveTo-stamping (clause-
 * promotion.ts) guarantees the timeline stays contiguous with no gap and no
 * overlap, since the prior version's effectiveTo is always set to exactly
 * the new version's effectiveFrom.
 */
export async function addVersion(ctx: RequestContext, clauseId: string, input: AddClauseVersionInput): Promise<ClauseVersionRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const clause = await findClauseById(tx, scope.companyId, clauseId);
    if (!clause) {
      throw new NotFoundError("Clause not found");
    }

    const existingVersions = await listVersionsForClause(tx, scope.companyId, clauseId);
    const latestEffectiveFrom = existingVersions
      .map((v) => v.effectiveFrom)
      .sort()
      .at(-1);
    if (latestEffectiveFrom && input.effectiveFrom <= latestEffectiveFrom) {
      throw new ConflictError(
        `effectiveFrom (${input.effectiveFrom}) must be after the latest existing version's effectiveFrom (${latestEffectiveFrom}) - overlapping or gapping effective windows are not allowed`,
      );
    }

    const nextVersionNumber = (await findMaxVersionNumber(tx, clauseId)) + 1;

    const version = await insertClauseVersion(tx, {
      companyId: scope.companyId,
      clauseId,
      versionNumber: nextVersionNumber,
      clauseText: input.clauseText,
      effectiveFrom: input.effectiveFrom,
      changeReason: input.changeReason,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause_version",
      entityId: version.id,
      action: "clause_version.created",
      after: { clauseId, versionNumber: version.versionNumber, effectiveFrom: version.effectiveFrom, changeReason: version.changeReason },
    });

    return version;
  });
}

/**
 * Draft -> Approved only (permission contract.clause.approve). A version
 * only ever reaches 'active' via promoteVersion (clause-promotion.ts) - the
 * scheduler or the on-access fallback - never directly from this endpoint,
 * even if effectiveFrom is already in the past: approving and promoting are
 * deliberately separate steps so a past-dated effectiveFrom doesn't jump
 * straight to Active before whatever approval process the client requires
 * (docs/CONTRACT-MODULE-BUILD.md Part 6: "should a new clause version
 * require legal sign-off before going Active? - usually yes") has actually
 * happened.
 */
export async function approveVersion(ctx: RequestContext, clauseId: string, versionId: string): Promise<ClauseVersionRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const clause = await findClauseById(tx, scope.companyId, clauseId);
    if (!clause) {
      throw new NotFoundError("Clause not found");
    }
    const existing = await findClauseVersionById(tx, scope.companyId, clauseId, versionId);
    if (!existing) {
      throw new NotFoundError("Clause version not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictError(`Version ${existing.versionNumber} is "${existing.status}", not "draft" - cannot approve`);
    }

    const row = await updateClauseVersion(tx, versionId, {
      status: "approved",
      approvedBy: scope.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    });
    if (!row) {
      throw new ConflictError(`Version ${existing.versionNumber} could not be approved`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause_version",
      entityId: versionId,
      action: "clause_version.approved",
      before: { status: existing.status },
      after: { status: row.status },
    });

    // The on-access fallback: an approval whose effectiveFrom is already
    // today-or-earlier should be visibly Active the instant it's approved,
    // not just at the scheduler's next tick. Re-fetch after promoting -
    // `row` is a stale snapshot from the update above (still "approved");
    // returning it unrefreshed would silently lie to the caller about a
    // promotion that just happened in this same transaction.
    await promoteDueVersions(tx);
    const refreshed = await findClauseVersionById(tx, scope.companyId, clauseId, versionId);
    return refreshed ?? row;
  });
}

/** contract.clause.deactivate - soft-deactivates the CLAUSE (is_active=false), not any one version. A deactivated clause stops appearing in "add from library" pickers (C-3b) but its history and any already-assembled contract snapshot are untouched. */
export async function deactivate(ctx: RequestContext, clauseId: string): Promise<ClauseRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findClauseById(tx, scope.companyId, clauseId);
    if (!existing) {
      throw new NotFoundError("Clause not found");
    }

    const row = await updateClauseFields(tx, scope.companyId, clauseId, {
      isActive: false,
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!row) {
      throw new NotFoundError("Clause not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "clause",
      entityId: clauseId,
      action: "clause.deactivated",
      before: { isActive: existing.isActive },
      after: { isActive: false },
    });

    return row;
  });
}
