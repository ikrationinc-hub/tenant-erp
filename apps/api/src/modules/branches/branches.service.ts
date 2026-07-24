import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { MasterOption, PaginatedRows } from "../../core/masters/types.js";
import { withTenantDb } from "../../database/get-db.js";
import type { BranchRow, BranchesListParams } from "./branches.repository.js";
import {
  findBranchByCode,
  findBranchById,
  insertBranch,
  listActiveBranches,
  listBranches,
  updateBranch,
} from "./branches.repository.js";
import type { CreateBranchInput, UpdateBranchInput } from "./branches.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export async function list(ctx: RequestContext, params: BranchesListParams): Promise<PaginatedRows<BranchRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listBranches(tx, scope.companyId, params));
}

export async function listOptions(ctx: RequestContext): Promise<MasterOption[]> {
  const scope = requireTenantScope(ctx);
  const rows = await withTenantDb(ctx, (tx) => listActiveBranches(tx, scope.companyId));
  return rows.map((row) => ({ value: row.id, label: row.name }));
}

/** company_id is NEVER accepted from the request body (task item 3, rule 2) - always ctx.tenantScope.companyId. */
export async function create(ctx: RequestContext, input: CreateBranchInput): Promise<BranchRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findBranchByCode(tx, scope.companyId, input.code);
    if (existing) {
      throw new ConflictError(`A branch with code "${input.code}" already exists`);
    }

    const row = await insertBranch(tx, {
      ...input,
      companyId: scope.companyId,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "branch",
      entityId: row.id,
      action: "branch.created",
      after: input,
    });

    return row;
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateBranchInput): Promise<BranchRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findBranchById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Branch not found");
    }

    if (input.code && input.code !== existing.code) {
      const codeOwner = await findBranchByCode(tx, scope.companyId, input.code);
      if (codeOwner && codeOwner.id !== id) {
        throw new ConflictError(`A branch with code "${input.code}" already exists`);
      }
    }

    const row = await updateBranch(tx, scope.companyId, id, { ...input, updatedBy: scope.userId });
    if (!row) {
      throw new NotFoundError("Branch not found");
    }

    const keys = Object.keys(input);
    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "branch",
      entityId: id,
      action: "branch.updated",
      before: pick(existing, keys),
      after: pick(row, keys),
    });

    return row;
  });
}

function pick(source: BranchRow, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = (source as unknown as Record<string, unknown>)[key];
  }
  return result;
}
