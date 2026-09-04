import { Readable } from "node:stream";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { withTenantDb } from "../../database/get-db.js";
import { uploadAttachment } from "../attachments/attachments.service.js";
import type { AttachmentRow } from "../attachments/attachments.repository.js";
import { findClauseById } from "./clauses.repository.js";
import { buildDefaultContractDocx } from "./default-docx-template.js";
import {
  findContractTemplateById,
  insertContractTemplate,
  insertTemplateClause,
  listContractTemplates,
  listTemplateClauses,
  removeTemplateClause,
  updateContractTemplateFields,
  type ContractTemplateRow,
  type ContractTemplatesListParams,
  type TemplateClauseWithTitle,
} from "./contract-templates.repository.js";
import type { AddTemplateClauseInput, CreateContractTemplateInput, UpdateContractTemplateInput } from "./contract-templates.validator.js";

export const TEMPLATE_FILE_ENTITY = "contract_template";
export const TEMPLATE_FILE_FIELD_KEY = "templateFile";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export interface ContractTemplateWire extends ContractTemplateRow {
  templateClauses: TemplateClauseWithTitle[];
}

export async function list(ctx: RequestContext, params: ContractTemplatesListParams): Promise<PaginatedRows<ContractTemplateRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listContractTemplates(tx, scope.companyId, params));
}

export async function getById(ctx: RequestContext, id: string): Promise<ContractTemplateWire> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const template = await findContractTemplateById(tx, scope.companyId, id);
    if (!template) {
      throw new NotFoundError("Contract template not found");
    }
    const templateClauses = await listTemplateClauses(tx, scope.companyId, id);
    return { ...template, templateClauses };
  });
}

/** Template management is master-style CRUD (item 1) - a template names a division + contract type; its clause set is built up afterward via addClause/removeClause below. */
export async function create(ctx: RequestContext, input: CreateContractTemplateInput): Promise<ContractTemplateRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const template = await insertContractTemplate(tx, {
      companyId: scope.companyId,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      ...(input.divisionId ? { divisionId: input.divisionId } : {}),
      name: input.name,
      contractType: input.contractType,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_template",
      entityId: template.id,
      action: "contract_template.created",
      after: { name: template.name, contractType: template.contractType, divisionId: template.divisionId },
    });

    return template;
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateContractTemplateInput): Promise<ContractTemplateRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findContractTemplateById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Contract template not found");
    }

    const row = await updateContractTemplateFields(tx, scope.companyId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.contractType !== undefined ? { contractType: input.contractType } : {}),
      ...(input.divisionId !== undefined ? { divisionId: input.divisionId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedBy: scope.userId,
      updatedAt: new Date(),
    });
    if (!row) {
      throw new NotFoundError("Contract template not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_template",
      entityId: id,
      action: "contract_template.updated",
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: row.name, isActive: row.isActive },
    });

    return row;
  });
}

export async function addClause(ctx: RequestContext, templateId: string, input: AddTemplateClauseInput): Promise<TemplateClauseWithTitle[]> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const template = await findContractTemplateById(tx, scope.companyId, templateId);
    if (!template) {
      throw new NotFoundError("Contract template not found");
    }
    const clause = await findClauseById(tx, scope.companyId, input.clauseId);
    if (!clause) {
      throw new NotFoundError("Clause not found");
    }

    const existing = await listTemplateClauses(tx, scope.companyId, templateId);
    if (existing.some((tc) => tc.clauseId === input.clauseId)) {
      throw new ConflictError("This clause is already on the template");
    }
    const nextSortOrder = existing.length === 0 ? 0 : Math.max(...existing.map((tc) => tc.sortOrder)) + 1;

    await insertTemplateClause(tx, {
      templateId,
      companyId: scope.companyId,
      clauseId: input.clauseId,
      isMandatory: input.isMandatory ?? false,
      sortOrder: nextSortOrder,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_template",
      entityId: templateId,
      action: "contract_template.clause_added",
      after: { clauseId: input.clauseId, isMandatory: input.isMandatory ?? false },
    });

    return listTemplateClauses(tx, scope.companyId, templateId);
  });
}

/**
 * "Generate starter .docx" (Templates screen) - builds the same minimal
 * OOXML shell contract-generation.service.ts's no-template fallback would
 * use, but ATTACHES it to this template via the existing attachments
 * pipeline (entity="contract_template", fieldKey="templateFile" - see
 * that constant's own doc comment) exactly as a manual upload would, so
 * it goes through the real virus-scan/storage path and immediately
 * becomes the template's active file. The user can then download and
 * customize it in Word before re-uploading, or use it as-is.
 */
export async function generateDefaultDocx(ctx: RequestContext, templateId: string): Promise<AttachmentRow> {
  const scope = requireTenantScope(ctx);

  const template = await withTenantDb(ctx, (tx) => findContractTemplateById(tx, scope.companyId, templateId));
  if (!template) {
    throw new NotFoundError("Contract template not found");
  }

  const buffer = buildDefaultContractDocx();
  return uploadAttachment(ctx, {
    entity: TEMPLATE_FILE_ENTITY,
    entityId: templateId,
    fieldKey: TEMPLATE_FILE_FIELD_KEY,
    filename: `${template.name.replace(/[^\w.-]+/g, "_")}-starter.docx`,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    stream: Readable.from(buffer),
  });
}

export async function removeClause(ctx: RequestContext, templateId: string, clauseId: string): Promise<TemplateClauseWithTitle[]> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const template = await findContractTemplateById(tx, scope.companyId, templateId);
    if (!template) {
      throw new NotFoundError("Contract template not found");
    }
    const removed = await removeTemplateClause(tx, scope.companyId, templateId, clauseId);
    if (!removed) {
      throw new NotFoundError("This clause is not on the template");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "contract_template",
      entityId: templateId,
      action: "contract_template.clause_removed",
      before: { clauseId },
    });

    return listTemplateClauses(tx, scope.companyId, templateId);
  });
}
