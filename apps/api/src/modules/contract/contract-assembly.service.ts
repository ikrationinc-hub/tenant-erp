import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { TenantTx } from "../../database/get-db.js";
import { withTenantDb } from "../../database/get-db.js";
import { findActiveVersion, findClauseById } from "./clauses.repository.js";
import { buildContractPlaceholderContext, CONTRACT_MONEY_TOKENS } from "./contract-context.js";
import {
  findContractClauseById,
  insertContractClause,
  listContractClauses,
  removeContractClause,
  updateContractClauseFields,
  type ContractClauseRow,
} from "./contract-clauses.repository.js";
import { listContractParties } from "./contract-parties.repository.js";
import type { TemplateClauseWithTitle } from "./contract-templates.repository.js";
import { extractPlaceholderTokens, resolvePlaceholders } from "./placeholder-resolver.js";
import { findContractById } from "./contracts.repository.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/** Resolves a clause's CURRENTLY ACTIVE version and snapshots its resolved text against `context` - the one piece of logic every snapshot-writing path (template assembly, add-from-library, re-snapshot) shares. Throws if the clause has no Active version (nothing to snapshot) - never silently skips a clause the caller explicitly asked to add. */
async function snapshotClause(
  tx: TenantTx,
  companyId: string,
  clauseId: string,
  context: Awaited<ReturnType<typeof buildContractPlaceholderContext>>,
): Promise<{ clauseVersionId: string; resolvedText: string }> {
  const activeVersion = await findActiveVersion(tx, companyId, clauseId);
  if (!activeVersion) {
    const clause = await findClauseById(tx, companyId, clauseId);
    throw new ConflictError(`Clause "${clause?.clauseTitle ?? clauseId}" has no Active version - it cannot be added to a contract`);
  }
  const { values } = resolvePlaceholders(activeVersion.clauseText, context, { moneyTokens: CONTRACT_MONEY_TOKENS });
  let resolvedText = activeVersion.clauseText;
  for (const token of extractPlaceholderTokens(activeVersion.clauseText)) {
    resolvedText = resolvedText.replaceAll(`{{${token}}}`, values[token] ?? "");
  }
  return { clauseVersionId: activeVersion.id, resolvedText };
}

/** Called from contracts.service.ts's create(), inside the SAME transaction as the contract's own insert - "selecting a template loads its default clauses" IS this function, run automatically at create time when a template was chosen. */
export async function assembleFromTemplate(
  tx: TenantTx,
  input: { companyId: string; contractId: string; userId: string; templateClauses: TemplateClauseWithTitle[] },
): Promise<void> {
  const contract = await findContractById(tx, input.companyId, input.contractId);
  if (!contract) {
    throw new NotFoundError("Contract not found");
  }
  const parties = await listContractParties(tx, input.companyId, input.contractId);
  const context = await buildContractPlaceholderContext(tx, contract, parties);

  for (const templateClause of input.templateClauses) {
    const { clauseVersionId, resolvedText } = await snapshotClause(tx, input.companyId, templateClause.clauseId, context);
    await insertContractClause(tx, {
      contractId: input.contractId,
      companyId: input.companyId,
      clauseId: templateClause.clauseId,
      clauseVersionId,
      resolvedText,
      sortOrder: templateClause.sortOrder,
      isMandatory: templateClause.isMandatory,
      createdBy: input.userId,
    });
  }
}

function requireDraft(contractStatus: string, contractNumber: string): void {
  if (contractStatus !== "draft") {
    throw new ConflictError(`Contract ${contractNumber} is ${contractStatus} - clauses can no longer be assembled`);
  }
}

/** Add-from-library (item 5) - Draft only. Appends at the end (highest existing sortOrder + 1); the drag-drop UI reorders afterward via reorder() below. Never mandatory (a manually-added clause was never a template's own requirement). */
export async function addClause(ctx: RequestContext, contractId: string, clauseId: string): Promise<ContractClauseRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    requireDraft(contract.status, contract.contractNumber);

    const parties = await listContractParties(tx, scope.companyId, contractId);
    const context = await buildContractPlaceholderContext(tx, contract, parties);
    const { clauseVersionId, resolvedText } = await snapshotClause(tx, scope.companyId, clauseId, context);

    const existing = await listContractClauses(tx, scope.companyId, contractId);
    const nextSortOrder = existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.sortOrder)) + 1;

    const row = await insertContractClause(tx, {
      contractId,
      companyId: scope.companyId,
      clauseId,
      clauseVersionId,
      resolvedText,
      sortOrder: nextSortOrder,
      isMandatory: false,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_clause",
      entityId: row.id,
      action: "contract_clause.added",
      after: { contractId, clauseId, sortOrder: row.sortOrder },
    });

    return row;
  });
}

/** Remove - blocked for a mandatory clause (item 5: "block removing mandatory"), Draft only. */
export async function removeClause(ctx: RequestContext, contractId: string, contractClauseId: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    requireDraft(contract.status, contract.contractNumber);

    const contractClause = await findContractClauseById(tx, scope.companyId, contractId, contractClauseId);
    if (!contractClause) {
      throw new NotFoundError("Contract clause not found");
    }
    if (contractClause.isMandatory) {
      throw new ConflictError("This clause is mandatory and cannot be removed");
    }

    await removeContractClause(tx, scope.companyId, contractId, contractClauseId);

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_clause",
      entityId: contractClauseId,
      action: "contract_clause.removed",
      before: { clauseId: contractClause.clauseId },
    });
  });
}

/** Persists a new sortOrder per contract_clauses row id, in the order given - the drag-drop UI's own "here is the full new order" payload, not a delta. Draft only. */
export async function reorderClauses(ctx: RequestContext, contractId: string, contractClauseIds: string[]): Promise<ContractClauseRow[]> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    requireDraft(contract.status, contract.contractNumber);

    const existing = await listContractClauses(tx, scope.companyId, contractId);
    const existingIds = new Set(existing.map((c) => c.id));
    if (contractClauseIds.length !== existing.length || !contractClauseIds.every((id) => existingIds.has(id))) {
      throw new ConflictError("The given clause id list does not match this contract's own assembled clauses exactly");
    }

    // Two-phase write: contract_clauses has a partial UNIQUE index on
    // (contractId, sortOrder) - writing final sort orders one row at a
    // time can transiently collide with another row's CURRENT sortOrder
    // mid-loop (e.g. clause A's target sortOrder 1 is still held by
    // clause B at that instant), which the DB rejects immediately, not
    // deferred. Bumping every row to a negative, guaranteed-unique
    // offset first (never collides with any real 0..N-1 target value or
    // with each other, since each row's own current index is unique)
    // clears the whole index before any row claims its real final value.
    for (const [index, contractClauseId] of contractClauseIds.entries()) {
      await updateContractClauseFields(tx, scope.companyId, contractId, contractClauseId, {
        sortOrder: -(index + 1),
        updatedBy: scope.userId,
        updatedAt: new Date(),
      });
    }
    for (const [index, contractClauseId] of contractClauseIds.entries()) {
      await updateContractClauseFields(tx, scope.companyId, contractId, contractClauseId, { sortOrder: index, updatedBy: scope.userId, updatedAt: new Date() });
    }

    return listContractClauses(tx, scope.companyId, contractId);
  });
}

/** Edit an editable clause's text on THIS contract (item 5) - records isEdited, NEVER touches clauses/clause_versions. Draft only. */
export async function editClauseText(ctx: RequestContext, contractId: string, contractClauseId: string, resolvedText: string): Promise<ContractClauseRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    requireDraft(contract.status, contract.contractNumber);

    const existing = await findContractClauseById(tx, scope.companyId, contractId, contractClauseId);
    if (!existing) {
      throw new NotFoundError("Contract clause not found");
    }

    const row = await updateContractClauseFields(tx, scope.companyId, contractId, contractClauseId, {
      resolvedText,
      isEdited: true,
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!row) {
      throw new NotFoundError("Contract clause not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_clause",
      entityId: contractClauseId,
      action: "contract_clause.edited",
      before: { resolvedText: existing.resolvedText },
      after: { resolvedText: row.resolvedText },
    });

    return row;
  });
}

export interface ResnapshotDiffEntry {
  contractClauseId: string;
  clauseId: string;
  changed: boolean;
  previousResolvedText: string;
  newResolvedText: string;
}

/**
 * "Update clauses to latest" (item 4) - Draft only, explicit, never
 * automatic. Re-resolves each of this contract's OWN clauses (by
 * clauseId) against whatever version is CURRENTLY Active, overwriting
 * clauseVersionId/resolvedText - a hand-edited clause (isEdited=true)
 * loses its edit on re-snapshot (this IS "update to latest": the point is
 * to discard drift from the library, edited or not - the diff returned
 * tells the caller exactly what changed so this is never a silent
 * overwrite). A Signed/Approved contract can never reach this - see the
 * caller's own guard.
 */
export async function resnapshotToLatest(ctx: RequestContext, contractId: string): Promise<ResnapshotDiffEntry[]> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    requireDraft(contract.status, contract.contractNumber);

    const existingClauses = await listContractClauses(tx, scope.companyId, contractId);
    const parties = await listContractParties(tx, scope.companyId, contractId);
    const context = await buildContractPlaceholderContext(tx, contract, parties);

    const diff: ResnapshotDiffEntry[] = [];
    for (const existing of existingClauses) {
      const { clauseVersionId, resolvedText } = await snapshotClause(tx, scope.companyId, existing.clauseId, context);
      const changed = clauseVersionId !== existing.clauseVersionId || resolvedText !== existing.resolvedText;
      if (changed) {
        await updateContractClauseFields(tx, scope.companyId, contractId, existing.id, {
          clauseVersionId,
          resolvedText,
          isEdited: false,
          updatedBy: scope.userId,
          updatedAt: new Date(),
        });
      }
      diff.push({ contractClauseId: existing.id, clauseId: existing.clauseId, changed, previousResolvedText: existing.resolvedText, newResolvedText: resolvedText });
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: contractId,
      action: "contract.clauses_resnapshotted",
      after: { changedCount: diff.filter((d) => d.changed).length, totalCount: diff.length },
    });

    return diff;
  });
}

export interface ContractPreview {
  clauses: { contractClauseId: string; clauseTitle: string; resolvedText: string }[];
}

/** Preview (item 5) - resolves placeholders against THIS contract's data and returns the assembled text, read-only, no write. Works at any status (a Signed contract can still be previewed/re-read, just never re-assembled). */
export async function preview(ctx: RequestContext, contractId: string): Promise<ContractPreview> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, contractId);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    const clauseRows = await listContractClauses(tx, scope.companyId, contractId);

    const clausesWithTitles = await Promise.all(
      clauseRows.map(async (row) => {
        const clause = await findClauseById(tx, scope.companyId, row.clauseId);
        return { contractClauseId: row.id, clauseTitle: clause?.clauseTitle ?? row.clauseId, resolvedText: row.resolvedText };
      }),
    );

    return { clauses: clausesWithTitles };
  });
}
