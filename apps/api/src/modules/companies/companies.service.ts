import type { RequestContext } from "../../common/context/request-context.js";
import { NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { withTenantDb } from "../../database/get-db.js";
import type { CompaniesListParams, CompanyRow } from "./companies.repository.js";
import { findCompanyById, insertCompany, listCompanies, updateCompany } from "./companies.repository.js";
import type { CreateCompanyInput, UpdateCompanyInput } from "./companies.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export async function list(ctx: RequestContext, params: CompaniesListParams): Promise<PaginatedRows<CompanyRow>> {
  requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listCompanies(tx, params));
}

export async function create(ctx: RequestContext, input: CreateCompanyInput): Promise<CompanyRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const row = await insertCompany(tx, { ...input, createdBy: scope.userId });

    await insertAuditLog(tx, {
      companyId: row.id,
      changedBy: scope.userId,
      entity: "company",
      entityId: row.id,
      action: "company.created",
      after: input,
    });

    return row;
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateCompanyInput): Promise<CompanyRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findCompanyById(tx, id);
    if (!existing) {
      throw new NotFoundError("Company not found");
    }

    const row = await updateCompany(tx, id, { ...input, updatedBy: scope.userId });
    if (!row) {
      throw new NotFoundError("Company not found");
    }

    const keys = Object.keys(input);
    await insertAuditLog(tx, {
      companyId: id,
      changedBy: scope.userId,
      entity: "company",
      entityId: id,
      action: "company.updated",
      before: pick(existing, keys),
      after: pick(row, keys),
    });

    return row;
  });
}

function pick(source: CompanyRow, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = (source as unknown as Record<string, unknown>)[key];
  }
  return result;
}
