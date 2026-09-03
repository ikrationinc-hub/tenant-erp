import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { parseMoney, roundAmount, roundRate } from "../../common/money/decimal.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { requireAtLeastOneValidLine } from "../../core/workflow/guards.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import { assembleFromTemplate } from "./contract-assembly.service.js";
import { listContractClauses, type ContractClauseRow } from "./contract-clauses.repository.js";
import { upsertContractParty, listContractParties, type ContractPartyRow } from "./contract-parties.repository.js";
import { findContractTemplateById, listTemplateClauses } from "./contract-templates.repository.js";
import { findLinkedSourceSummary, type LinkedSourceSummary } from "./contract-source-link.js";
import {
  findContractById,
  insertContract,
  listContracts,
  transitionContractStatus,
  updateContractFields,
  type ContractRow,
  type ContractsListParams,
} from "./contracts.repository.js";
import type { CreateContractInput, UpdateContractInput } from "./contracts.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export interface ContractWire extends ContractRow {
  parties: ContractPartyRow[];
  clauses: ContractClauseRow[];
  linkedSource: LinkedSourceSummary | null;
}

async function buildContractWire(tx: TenantTx, companyId: string, contract: ContractRow): Promise<ContractWire> {
  const [parties, clauses, linkedSource] = await Promise.all([
    listContractParties(tx, companyId, contract.id),
    listContractClauses(tx, companyId, contract.id),
    findLinkedSourceSummary(tx, companyId, contract.sourceType, contract.sourceId),
  ]);
  return { ...contract, parties, clauses, linkedSource };
}

/** Draft -> Approved -> Signed -> Closed (Part 2) - each its own permission, each its own single from/to edge (no multi-source transition here, unlike purchase's cancel - every one of these has exactly one starting status). */
const CONTRACT_WORKFLOW: WorkflowTransition<ContractRow["status"], { clauses: ContractClauseRow[] }>[] = [
  {
    name: "approve",
    from: "draft",
    to: "approved",
    permission: "contract.assemble",
    guards: [
      (context) =>
        requireAtLeastOneValidLine(context.clauses, () => undefined, "Cannot approve: contract has no clauses"),
    ],
  },
  {
    name: "sign",
    from: "approved",
    to: "signed",
    permission: "contract.assemble",
  },
  {
    name: "close",
    from: "signed",
    to: "closed",
    permission: "contract.assemble",
  },
];

export async function list(ctx: RequestContext, params: ContractsListParams): Promise<PaginatedRows<ContractRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listContracts(tx, scope.companyId, params));
}

export async function getById(ctx: RequestContext, id: string): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const contract = await findContractById(tx, scope.companyId, id);
    if (!contract) {
      throw new NotFoundError("Contract not found");
    }
    return buildContractWire(tx, scope.companyId, contract);
  });
}

/**
 * LINK or STANDALONE (Part 2 item 3): when `input.source` is given, the
 * linked document's commercial/shipment fields PREFILL this contract's own
 * real columns (contract-source-link.ts's own resolver) but are stored as
 * this contract's OWN values from this moment on - never re-read live from
 * the source afterward, and the caller's own explicit materialType/
 * weightKg/rateUsd/deliveryTerms (if given) override whatever the link
 * would have prefilled, so "stays editable" is true even at create time,
 * not just after. Standalone (no `source`) leaves every commercial field
 * exactly as manually entered, with no prefill step at all.
 *
 * Selecting a template auto-assembles its default clause set in the SAME
 * transaction as the contract's own insert - "load template defaults" is
 * this create call's own side effect, not a separate step the caller must
 * remember to invoke (though the standalone assembly endpoints - add/
 * remove/reorder - still work afterward regardless of whether a template
 * was used at all).
 */
export async function create(ctx: RequestContext, input: CreateContractInput): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const prefill = input.source ? await findLinkedSourceSummary(tx, scope.companyId, input.source.sourceType, input.source.sourceId) : null;
    if (input.source && !prefill) {
      throw new NotFoundError(`Linked ${input.source.sourceType} not found`);
    }

    const contractNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "CONTRACT",
      date: new Date(input.contractDate),
    });

    const template = input.templateId ? await findContractTemplateById(tx, scope.companyId, input.templateId) : undefined;
    if (input.templateId && !template) {
      throw new NotFoundError("Contract template not found");
    }

    const contract = await insertContract(tx, {
      companyId: scope.companyId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.divisionId ? { divisionId: input.divisionId } : (template?.divisionId ? { divisionId: template.divisionId } : {})),
      contractNumber,
      contractDate: input.contractDate,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.source ? { sourceType: input.source.sourceType, sourceId: input.source.sourceId } : {}),
      materialType: input.materialType ?? prefill?.materialType,
      weightKg: input.weightKg !== undefined ? roundRate(parseMoney(input.weightKg)) : prefill?.weightKg,
      rateUsd: input.rateUsd !== undefined ? roundAmount(parseMoney(input.rateUsd)) : prefill?.rateUsd,
      deliveryTerms: input.deliveryTerms ?? prefill?.deliveryTerms,
      createdBy: scope.userId,
    });

    if (input.seller) {
      await upsertContractParty(tx, {
        contractId: contract.id,
        companyId: scope.companyId,
        partyRole: "seller",
        ...(input.seller.supplierId ? { supplierId: input.seller.supplierId } : {}),
        ...(input.seller.customerId ? { customerId: input.seller.customerId } : {}),
        createdBy: scope.userId,
      });
    }
    if (input.buyer) {
      await upsertContractParty(tx, {
        contractId: contract.id,
        companyId: scope.companyId,
        partyRole: "buyer",
        ...(input.buyer.supplierId ? { supplierId: input.buyer.supplierId } : {}),
        ...(input.buyer.customerId ? { customerId: input.buyer.customerId } : {}),
        createdBy: scope.userId,
      });
    }

    if (template) {
      const templateClauses = await listTemplateClauses(tx, scope.companyId, template.id);
      await assembleFromTemplate(tx, { companyId: scope.companyId, contractId: contract.id, userId: scope.userId, templateClauses });
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: contract.id,
      action: "contract.created",
      after: { contractNumber: contract.contractNumber, divisionId: contract.divisionId, sourceType: contract.sourceType, sourceId: contract.sourceId },
    });

    return buildContractWire(tx, scope.companyId, contract);
  });
}

/** Draft only - the same lock every other document in this codebase applies once a document leaves Draft. */
export async function update(ctx: RequestContext, id: string, input: UpdateContractInput): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findContractById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Contract not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictError(`Contract ${existing.contractNumber} is ${existing.status} and can no longer be edited`);
    }

    const row = await updateContractFields(tx, scope.companyId, id, {
      ...(input.divisionId !== undefined ? { divisionId: input.divisionId } : {}),
      ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
      ...(input.contractDate !== undefined ? { contractDate: input.contractDate } : {}),
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

    if (input.seller) {
      await upsertContractParty(tx, {
        contractId: id,
        companyId: scope.companyId,
        partyRole: "seller",
        ...(input.seller.supplierId ? { supplierId: input.seller.supplierId } : {}),
        ...(input.seller.customerId ? { customerId: input.seller.customerId } : {}),
        createdBy: scope.userId,
      });
    }
    if (input.buyer) {
      await upsertContractParty(tx, {
        contractId: id,
        companyId: scope.companyId,
        partyRole: "buyer",
        ...(input.buyer.supplierId ? { supplierId: input.buyer.supplierId } : {}),
        ...(input.buyer.customerId ? { customerId: input.buyer.customerId } : {}),
        createdBy: scope.userId,
      });
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: id,
      action: "contract.updated",
      before: { materialType: existing.materialType, weightKg: existing.weightKg, rateUsd: existing.rateUsd },
      after: { materialType: row.materialType, weightKg: row.weightKg, rateUsd: row.rateUsd },
    });

    return buildContractWire(tx, scope.companyId, row);
  });
}

async function runTransition(ctx: RequestContext, id: string, transitionName: string, extra?: Record<string, unknown>): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);
  const transition = findTransition(CONTRACT_WORKFLOW, transitionName);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findContractById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Contract not found");
    }
    const clauses = await listContractClauses(tx, scope.companyId, id);

    runGuards(transition, { clauses });

    const row = await transitionContractStatus(tx, scope.companyId, id, {
      from: transition.from,
      to: transition.to,
      extra: extra ?? {},
    });
    if (!row) {
      throw new ConflictError(`Contract ${existing.contractNumber} is "${existing.status}", not "${transition.from}" - cannot ${transitionName}`);
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: id,
      action: `contract.${transitionName}d`,
      before: { status: existing.status },
      after: { status: row.status },
    });

    return buildContractWire(tx, scope.companyId, row);
  });
}

export async function approve(ctx: RequestContext, id: string): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);
  return runTransition(ctx, id, "approve", { approvedBy: scope.userId, approvedAt: new Date() });
}

export async function sign(ctx: RequestContext, id: string): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);
  return runTransition(ctx, id, "sign", { signedBy: scope.userId, signedAt: new Date() });
}

export async function close(ctx: RequestContext, id: string): Promise<ContractWire> {
  return runTransition(ctx, id, "close");
}
