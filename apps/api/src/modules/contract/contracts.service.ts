import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { parseMoney, roundAmount, roundRate } from "../../common/money/decimal.js";
import { getESignatureProvider, type ESignatureWebhookPayload } from "../../core/esignature/provider.js";
import { getMailer } from "../../core/notification/mailer.js";
import { buildContractApprovalEmail } from "../../core/notification/templates/contract-approval-email.js";
import { buildContractEmail } from "../../core/notification/templates/contract-email.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { getPresignedDownloadUrl, readObjectAsBuffer, type PresignedDownloadUrl } from "../../core/storage/download.js";
import { requireAtLeastOneValidLine } from "../../core/workflow/guards.js";
import { findTransition, runGuards, type WorkflowTransition } from "../../core/workflow/transitions.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import { findCompanyById } from "../companies/companies.repository.js";
import { findUserByIdInCompany } from "../users/users.repository.js";
import { assembleFromTemplate } from "./contract-assembly.service.js";
import { insertContractClause, listContractClauses, type ContractClauseRow } from "./contract-clauses.repository.js";
import { upsertContractParty, listContractParties, type ContractPartyRow } from "./contract-parties.repository.js";
import { findContractTemplateById, listTemplateClauses } from "./contract-templates.repository.js";
import { findLinkedSourceSummary, type LinkedSourceSummary } from "./contract-source-link.js";
import {
  findContractByESignatureRequestId,
  findContractById,
  insertContract,
  listContracts,
  transitionContractStatus,
  updateContractFields,
  type ContractRow,
  type ContractsListParams,
} from "./contracts.repository.js";
import type {
  CreateContractInput,
  EmailContractInput,
  SendForApprovalInput,
  SendForESignatureInput,
  UpdateContractInput,
} from "./contracts.validator.js";

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
    // Documentation-only (transitions.ts's own design: the route itself
    // enforces this, via contract.routes.ts's requirePermission call) - kept
    // in sync with the ACTUAL enforced key, contract.document.assemble
    // (contract.routes.ts:49), not a separate unregistered permission.
    permission: "contract.document.assemble",
    guards: [
      (context) =>
        requireAtLeastOneValidLine(context.clauses, () => undefined, "Cannot approve: contract has no clauses"),
    ],
  },
  {
    name: "sign",
    from: "approved",
    to: "signed",
    permission: "contract.document.assemble",
  },
  {
    name: "close",
    from: "signed",
    to: "closed",
    permission: "contract.document.assemble",
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
 * "Print" needs the ACTUAL generated document, not a browser print of the
 * SPA's own chrome (sidebar/nav/buttons) - window.print() on the app page
 * was the wrong shortcut. This returns a fresh presigned URL for the
 * contract's durable lastGeneratedPdfKey; the frontend opens it in a new
 * tab so the browser's native PDF viewer (and its own print button) takes
 * over, printing the real contract document.
 */
export async function getDocumentUrl(ctx: RequestContext, id: string): Promise<PresignedDownloadUrl> {
  const scope = requireTenantScope(ctx);
  const contract = await withTenantDb(ctx, (tx) => findContractById(tx, scope.companyId, id));
  if (!contract) {
    throw new NotFoundError("Contract not found");
  }
  if (!contract.lastGeneratedPdfKey) {
    throw new ConflictError("This contract has no generated PDF yet - generate a document before printing it");
  }
  return getPresignedDownloadUrl(contract.lastGeneratedPdfKey);
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
      ...(input.contractType ? { contractType: input.contractType } : {}),
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
      after: {
        contractNumber: contract.contractNumber,
        divisionId: contract.divisionId,
        contractType: contract.contractType,
        sourceType: contract.sourceType,
        sourceId: contract.sourceId,
      },
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

/**
 * C-4 item 4 - "Send for Approval routes to an approver": Draft-only (the
 * same lock every other pre-approval mutation applies) - stamps WHO this
 * was routed to/by/when on the contract row itself (approvalRequestedFor/
 * By/At), then best-effort emails that user if they have an address on
 * file. The approver still clicks Approve themselves via the existing
 * `approve` transition above - this only notifies/records the request, it
 * does not grant or check any approval authority itself (that stays with
 * whatever permission gates PATCH /:id/approve).
 */
export async function sendForApproval(ctx: RequestContext, id: string, input: SendForApprovalInput): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);

  const { row, approver, company } = await withTenantDb(ctx, async (tx) => {
    const existing = await findContractById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Contract not found");
    }
    if (existing.status !== "draft") {
      throw new ConflictError(`Contract ${existing.contractNumber} is ${existing.status} - approval can only be requested on a Draft contract`);
    }

    const approverRow = await findUserByIdInCompany(tx, scope.companyId, input.approverId);
    if (!approverRow) {
      throw new NotFoundError("Approver not found");
    }

    const updated = await updateContractFields(tx, scope.companyId, id, {
      approvalRequestedFor: input.approverId,
      approvalRequestedBy: scope.userId,
      approvalRequestedAt: new Date(),
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundError("Contract not found");
    }

    const requestedByRow = await findUserByIdInCompany(tx, scope.companyId, scope.userId);
    const companyRow = await findCompanyById(tx, scope.companyId);

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: id,
      action: "contract.approval_requested",
      after: { approvalRequestedFor: input.approverId },
    });

    return { row: updated, approver: approverRow, company: companyRow, requestedBy: requestedByRow };
  });

  if (approver.email) {
    await getMailer().send(
      buildContractApprovalEmail({
        to: approver.email,
        contractNumber: row.contractNumber,
        requestedByName: company?.name ? `A colleague at ${company.name}` : "A colleague",
      }),
    );
  }

  return withTenantDb(ctx, (tx) => buildContractWire(tx, scope.companyId, row));
}

/**
 * C-4 item 4 - "changes need a new revision - parent_contract_id": the
 * SNAPSHOT (contract_clauses) is already effectively frozen for any
 * non-Draft contract (every assembly mutation in contract-assembly.service.ts
 * already requires Draft) - so the only genuinely new piece here is
 * CREATING the next revision: a brand-new Draft contract row, linked via
 * parentContractId, with revisionNumber incremented, and the parent's own
 * frozen clause snapshot copied over as fresh, independently-editable rows
 * (never a live reference back to the parent's own contract_clauses - this
 * new revision has to survive the parent being edited or deleted).
 * Deliberately does NOT touch the parent's own status/fields at all - no
 * auto-supersede - since whether an old revision should be closed/archived
 * automatically is an unconfirmed business rule (spec PART 6).
 */
export async function revise(ctx: RequestContext, id: string): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const parent = await findContractById(tx, scope.companyId, id);
    if (!parent) {
      throw new NotFoundError("Contract not found");
    }
    if (parent.status === "draft") {
      throw new ConflictError(`Contract ${parent.contractNumber} is still Draft - a revision is only needed once a contract has left Draft`);
    }

    const parentClauses = await listContractClauses(tx, scope.companyId, id);
    const parentParties = await listContractParties(tx, scope.companyId, id);

    const contractNumber = await nextNumber(tx, {
      companyId: scope.companyId,
      docType: "CONTRACT",
      date: new Date(),
    });

    const revised = await insertContract(tx, {
      companyId: scope.companyId,
      ...(parent.branchId ? { branchId: parent.branchId } : {}),
      ...(parent.divisionId ? { divisionId: parent.divisionId } : {}),
      contractNumber,
      contractDate: parent.contractDate,
      ...(parent.templateId ? { templateId: parent.templateId } : {}),
      ...(parent.contractType ? { contractType: parent.contractType } : {}),
      ...(parent.sourceType ? { sourceType: parent.sourceType, sourceId: parent.sourceId } : {}),
      materialType: parent.materialType,
      weightKg: parent.weightKg,
      rateUsd: parent.rateUsd,
      deliveryTerms: parent.deliveryTerms,
      parentContractId: parent.id,
      revisionNumber: parent.revisionNumber + 1,
      createdBy: scope.userId,
    });

    for (const party of parentParties) {
      await upsertContractParty(tx, {
        contractId: revised.id,
        companyId: scope.companyId,
        partyRole: party.partyRole,
        ...(party.supplierId ? { supplierId: party.supplierId } : {}),
        ...(party.customerId ? { customerId: party.customerId } : {}),
        createdBy: scope.userId,
      });
    }

    for (const clause of parentClauses) {
      await insertContractClause(tx, {
        contractId: revised.id,
        companyId: scope.companyId,
        clauseId: clause.clauseId,
        clauseVersionId: clause.clauseVersionId,
        resolvedText: clause.resolvedText,
        sortOrder: clause.sortOrder,
        isMandatory: clause.isMandatory,
        isFromRule: clause.isFromRule,
        createdBy: scope.userId,
      });
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: revised.id,
      action: "contract.revised",
      before: { parentContractId: parent.id, parentContractNumber: parent.contractNumber },
      after: { contractNumber: revised.contractNumber, revisionNumber: revised.revisionNumber },
    });

    return buildContractWire(tx, scope.companyId, revised);
  });
}

/**
 * C-4 item 6 - "Email Contract: send the generated PDF". Reads the PDF's
 * actual bytes from S3/MinIO via the durable lastGeneratedPdfKey (written
 * by contract-generation.service.ts's getGenerationJobStatus the first
 * time a generation job is observed complete) - never re-generates, never
 * reads BullMQ job state itself. Runs synchronously in the API process:
 * this is fetch-and-forward of an already-generated file, not document
 * GENERATION, so the worker-only rule for generation doesn't apply here.
 */
export async function emailContract(ctx: RequestContext, id: string, input: EmailContractInput): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);

  const contract = await withTenantDb(ctx, (tx) => findContractById(tx, scope.companyId, id));
  if (!contract) {
    throw new NotFoundError("Contract not found");
  }
  if (!contract.lastGeneratedPdfKey) {
    throw new ConflictError("This contract has no generated PDF yet - generate a document before emailing it");
  }

  const [pdfBytes, company] = await Promise.all([
    readObjectAsBuffer(contract.lastGeneratedPdfKey),
    withTenantDb(ctx, (tx) => findCompanyById(tx, scope.companyId)),
  ]);

  await getMailer().send(
    buildContractEmail({
      to: input.to,
      contractNumber: contract.contractNumber,
      companyName: company?.name ?? "",
      pdfBytes,
    }),
  );

  return withTenantDb(ctx, async (tx) => {
    const updated = await updateContractFields(tx, scope.companyId, id, {
      lastEmailedAt: new Date(),
      lastEmailedTo: input.to,
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundError("Contract not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: id,
      action: "contract.emailed",
      after: { to: input.to },
    });

    return buildContractWire(tx, scope.companyId, updated);
  });
}

/**
 * C-4 item 5 - "Send for E-signature (stub)". Reads the same durable
 * lastGeneratedPdfKey used for email (a signature request needs the
 * actual document bytes, same as an email attachment does), sends via
 * whichever ESignatureProvider is currently active (the stub, always,
 * until a real provider is named and network access confirmed - see
 * core/esignature/provider.ts's own doc comment), and stamps the
 * provider's returned requestId + "sent" status onto the contract row.
 */
export async function sendForESignature(ctx: RequestContext, id: string, input: SendForESignatureInput): Promise<ContractWire> {
  const scope = requireTenantScope(ctx);

  const contract = await withTenantDb(ctx, (tx) => findContractById(tx, scope.companyId, id));
  if (!contract) {
    throw new NotFoundError("Contract not found");
  }
  if (!contract.lastGeneratedPdfKey) {
    throw new ConflictError("This contract has no generated PDF yet - generate a document before sending for e-signature");
  }

  const pdfBytes = await readObjectAsBuffer(contract.lastGeneratedPdfKey);
  const { requestId } = await getESignatureProvider().send({
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    signerEmail: input.signerEmail,
    pdfBytes,
  });

  return withTenantDb(ctx, async (tx) => {
    const updated = await updateContractFields(tx, scope.companyId, id, {
      esignatureStatus: "sent",
      esignatureRequestId: requestId,
      esignatureSentAt: new Date(),
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundError("Contract not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: id,
      action: "contract.esignature_sent",
      after: { requestId, signerEmail: input.signerEmail },
    });

    return buildContractWire(tx, scope.companyId, updated);
  });
}

/**
 * The webhook callback half of the abstraction. NOT mounted on any route
 * today - a real provider's inbound callback cannot carry one of our own
 * JWTs, and this codebase has no existing pattern for a differently-
 * authenticated inbound endpoint (every mounted route resolves tenant
 * scope from a JWT - see scope-resolver.ts's own "Resolved from the JWT
 * ONLY" comment). Designing that auth scheme (signed provider secret?
 * tenant id embedded in the callback URL?) depends entirely on which
 * provider's callback shape we're matching - an open question per this
 * phase's own spec ("provider is an open client question"), so it is NOT
 * invented here. This function exists so the STATUS-UPDATE logic itself
 * (and the stub provider's parseWebhook) is written and testable now;
 * exposing it over HTTP is deferred to when a real provider is chosen.
 */
export async function handleESignatureWebhook(ctx: RequestContext, payload: unknown): Promise<void> {
  const scope = requireTenantScope(ctx);
  const parsed: ESignatureWebhookPayload = getESignatureProvider().parseWebhook(payload);

  await withTenantDb(ctx, async (tx) => {
    const contract = await findContractByESignatureRequestId(tx, scope.companyId, parsed.requestId);
    if (!contract) {
      throw new NotFoundError("No contract found for this e-signature request");
    }

    const updated = await updateContractFields(tx, scope.companyId, contract.id, {
      esignatureStatus: parsed.status,
      ...(parsed.status === "signed" ? { esignatureCompletedAt: new Date() } : {}),
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundError("Contract not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract",
      entityId: contract.id,
      action: "contract.esignature_status_updated",
      before: { esignatureStatus: contract.esignatureStatus },
      after: { esignatureStatus: updated.esignatureStatus },
    });
  });
}
