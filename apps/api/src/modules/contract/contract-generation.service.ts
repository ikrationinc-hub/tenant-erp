import { Job, Queue } from "bullmq";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { redis } from "../../config/redis.js";
import { withTenantDb } from "../../database/get-db.js";
import { listAttachmentsForEntity } from "../attachments/attachments.repository.js";
import { CONTRACT_MONEY_TOKENS, buildContractPlaceholderContext } from "./contract-context.js";
import { listContractClauses } from "./contract-clauses.repository.js";
import { listContractParties } from "./contract-parties.repository.js";
import { findContractById, updateContractFields } from "./contracts.repository.js";

/**
 * C-3b item 5 ("generate Word/PDF - C-2's worker job"): the API-side
 * producer half of a BullMQ queue the WORKER (apps/worker/src/workers/
 * contract-generation.worker.ts) consumes - this is the first time
 * apps/api enqueues a job rather than only apps/worker producing/
 * consuming its own (C-1's clause-promotion scheduler). Deliberately a
 * SEPARATE Queue instance from the worker's own, connected to the same
 * Redis - BullMQ's own documented pattern for "API adds jobs, worker
 * processes them" (they only need to agree on the queue NAME and job data
 * shape, never share a process or a Queue object).
 */
const CONTRACT_GENERATION_QUEUE_NAME = "contract-generation";
const queue = new Queue(CONTRACT_GENERATION_QUEUE_NAME, { connection: redis });

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export interface GenerationJobHandle {
  jobId: string;
}

/**
 * The template's own .docx file is looked up via the EXISTING attachments
 * mechanism (entity="contract_template", fieldKey="templateFile") - no
 * dedicated upload endpoint or storage column was added for this; a
 * template's file is just an attachment like any other (see ADR 0023).
 * The most recently uploaded one wins if more than one was ever attached
 * (re-uploading replaces which file generation uses, without needing a
 * delete-then-upload dance). Returns null (never throws) when nothing has
 * been uploaded yet - the caller falls back to the worker's built-in
 * default shell rather than blocking generation.
 */
async function findTemplateStorageKey(ctx: RequestContext, templateId: string): Promise<string | null> {
  const page = await withTenantDb(ctx, (tx) =>
    listAttachmentsForEntity(tx, ctx.tenantScope?.companyId ?? "", { entity: "contract_template", entityId: templateId, page: 1, pageSize: 1 }),
  );
  return page.items[0]?.storageKey ?? null;
}

/** Enqueues the whole-contract generation job - every one of this contract's OWN snapshotted contract_clauses.resolved_text rows, concatenated in sortOrder, becomes the "clauseText" the worker substitutes into the template's single content placeholder. Already-resolved text (no {{tokens}} survive a snapshot) means the worker's own resolvePlaceholders call is a no-op pass-through for this path - see generate-document.ts's own doc comment. */
export async function enqueueGeneration(ctx: RequestContext, contractId: string): Promise<GenerationJobHandle> {
  const scope = requireTenantScope(ctx);

  const { contract, clauses, parties } = await withTenantDb(ctx, async (tx) => {
    const contractRow = await findContractById(tx, scope.companyId, contractId);
    if (!contractRow) {
      throw new NotFoundError("Contract not found");
    }
    const clauseRows = await listContractClauses(tx, scope.companyId, contractId);
    const partyRows = await listContractParties(tx, scope.companyId, contractId);
    return { contract: contractRow, clauses: clauseRows, parties: partyRows };
  });

  if (clauses.length === 0) {
    throw new ConflictError("This contract has no assembled clauses to generate");
  }
  /**
   * A standalone contract (no template) or a template with no .docx
   * attached yet both fall back to the worker's own built-in default
   * shell (see apps/worker's default-docx-template.ts) rather than
   * blocking generation outright - "Generate Word & PDF" should always
   * produce something usable, even with zero template setup. This is a
   * deliberate UX floor, not a substitute for a real letterhead: a
   * template author can still upload/replace a proper .docx at any time
   * (Contract Templates screen), which future generations then use.
   */
  const templateStorageKey = contract.templateId ? await findTemplateStorageKey(ctx, contract.templateId) : null;

  // Every clause is already-resolved snapshot text (no {{tokens}} remain -
  // that's the whole point of THE SNAPSHOT, item 4). The whole-contract
  // .docx TEMPLATE is expected to carry exactly one content placeholder,
  // {{contractBody}}, where the assembled clauses go - `clauseText` here
  // is deliberately the LITERAL string "{{contractBody}}", not the
  // assembled text itself: generateDocument's resolvePlaceholders(clauseText,
  // context, ...) extracts tokens FROM clauseText and looks them up IN
  // context, so contractBody must be a context key, not the text being
  // scanned. This is what lets a template author place {{contractBody}}
  // anywhere in their letterhead/layout, exactly like every other {{token}}
  // in this module - no special-casing in docx-renderer.ts at all.
  const context = await withTenantDb(ctx, (tx) => buildContractPlaceholderContext(tx, contract, parties));
  const contractBody = clauses.map((c) => c.resolvedText).join("\n\n");

  const job = await queue.add("generate", {
    tenantSchema: scope.tenantSchema,
    companyId: scope.companyId,
    clauseText: "{{contractBody}}",
    templateStorageKey,
    context: { ...context, contractBody },
    moneyTokens: [...CONTRACT_MONEY_TOKENS],
    filenameBase: contract.contractNumber,
    storageScopeId: contract.id,
  });
  if (!job.id) {
    throw new Error("BullMQ did not assign a job id");
  }

  return { jobId: job.id };
}

export interface GenerationJobStatus {
  jobId: string;
  state: string;
  result?: { docxStorageKey: string; pdfStorageKey: string };
  failedReason?: string;
}

/**
 * `contractId` is used ONLY to persist the durable copy of the result onto
 * the contract row (contracts.lastGeneratedDocxKey/PdfKey) the first time
 * this status is observed as completed - BullMQ job state ages out and is
 * never the durable source of truth. Re-fetching an already-persisted
 * completed status just re-writes the same values (idempotent, no guard
 * needed).
 */
export async function getGenerationJobStatus(ctx: RequestContext, contractId: string, jobId: string): Promise<GenerationJobStatus> {
  const scope = requireTenantScope(ctx);
  const job = await Job.fromId(queue, jobId);
  if (!job) {
    throw new NotFoundError("Generation job not found");
  }
  const state = await job.getState();

  if (state === "completed") {
    const result = job.returnvalue as { docxStorageKey: string; pdfStorageKey: string };
    await withTenantDb(ctx, (tx) =>
      updateContractFields(tx, scope.companyId, contractId, {
        lastGeneratedDocxKey: result.docxStorageKey,
        lastGeneratedPdfKey: result.pdfStorageKey,
        updatedBy: scope.userId,
      }),
    );
    return { jobId, state, result };
  }

  return {
    jobId,
    state,
    ...(state === "failed" ? { failedReason: job.failedReason } : {}),
  };
}
