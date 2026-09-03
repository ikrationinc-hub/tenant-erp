import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { parseMoney, roundAmount, roundRate } from "../../common/money/decimal.js";
import { withTenantDb } from "../../database/get-db.js";
import { findContractById, insertContract, updateContractFields, type ContractRow } from "./contracts.repository.js";
import type { CreateContractInput, UpdateContractInput } from "./contracts.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * C-3a: a minimal contract header create/read/update - just enough to
 * prove Scrap's division-scoped fields render AND PERSIST (docs/
 * CONTRACT-MODULE-BUILD.md's own test: "Values persist and reload
 * through the existing field mechanism"). No numbering, no workflow, no
 * clause assembly - C-3b's job, not this one's.
 */
export async function create(ctx: RequestContext, input: CreateContractInput): Promise<ContractRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const contract = await insertContract(tx, {
      companyId: scope.companyId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.divisionId ? { divisionId: input.divisionId } : {}),
      ...(input.materialType !== undefined ? { materialType: input.materialType } : {}),
      ...(input.weightKg !== undefined ? { weightKg: roundRate(parseMoney(input.weightKg)) } : {}),
      ...(input.rateUsd !== undefined ? { rateUsd: roundAmount(parseMoney(input.rateUsd)) } : {}),
      ...(input.deliveryTerms !== undefined ? { deliveryTerms: input.deliveryTerms } : {}),
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: contract.id,
      action: "contract.created",
      after: { divisionId: contract.divisionId, materialType: contract.materialType, weightKg: contract.weightKg, rateUsd: contract.rateUsd },
    });

    return contract;
  });
}

export async function getById(ctx: RequestContext, id: string): Promise<ContractRow> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, id);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    return contract;
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateContractInput): Promise<ContractRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findContractById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Contract not found");
    }

    const row = await updateContractFields(tx, scope.companyId, id, {
      ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
      ...(input.divisionId !== undefined ? { divisionId: input.divisionId } : {}),
      ...(input.materialType !== undefined ? { materialType: input.materialType } : {}),
      ...(input.weightKg !== undefined ? { weightKg: roundRate(parseMoney(input.weightKg)) } : {}),
      ...(input.rateUsd !== undefined ? { rateUsd: roundAmount(parseMoney(input.rateUsd)) } : {}),
      ...(input.deliveryTerms !== undefined ? { deliveryTerms: input.deliveryTerms } : {}),
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!row) {
      throw new NotFoundError("Contract not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: id,
      action: "contract.updated",
      before: { materialType: existing.materialType, weightKg: existing.weightKg, rateUsd: existing.rateUsd, deliveryTerms: existing.deliveryTerms },
      after: { materialType: row.materialType, weightKg: row.weightKg, rateUsd: row.rateUsd, deliveryTerms: row.deliveryTerms },
    });

    return row;
  });
}
