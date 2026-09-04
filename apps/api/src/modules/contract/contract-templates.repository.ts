import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { clauses, contractTemplateClauses, contractTemplates } from "../../database/tenant/schema.js";

export type ContractTemplateRow = typeof contractTemplates.$inferSelect;
export type ContractTemplateInsert = typeof contractTemplates.$inferInsert;
export type ContractTemplateClauseRow = typeof contractTemplateClauses.$inferSelect;
export type ContractTemplateClauseInsert = typeof contractTemplateClauses.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface ContractTemplatesListParams {
  page: number;
  pageSize: number;
  divisionId?: string | undefined;
}

export async function listContractTemplates(
  tx: TenantTx,
  companyId: string,
  params: ContractTemplatesListParams,
): Promise<PaginatedRows<ContractTemplateRow>> {
  const conditions = [eq(contractTemplates.companyId, companyId), isNull(contractTemplates.deletedAt)];
  if (params.divisionId) {
    conditions.push(eq(contractTemplates.divisionId, params.divisionId));
  }
  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(contractTemplates).where(where).orderBy(desc(contractTemplates.createdAt)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(contractTemplates).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

export async function insertContractTemplate(tx: TenantTx, values: ContractTemplateInsert): Promise<ContractTemplateRow> {
  const [row] = await tx.insert(contractTemplates).values(values).returning();
  if (!row) {
    throw new Error("failed to insert contract template");
  }
  return row;
}

export async function findContractTemplateById(tx: TenantTx, companyId: string, id: string): Promise<ContractTemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(contractTemplates)
    .where(and(eq(contractTemplates.id, id), eq(contractTemplates.companyId, companyId), isNull(contractTemplates.deletedAt)))
    .limit(1);
  return row;
}

export async function updateContractTemplateFields(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Partial<ContractTemplateInsert>,
): Promise<ContractTemplateRow | undefined> {
  const [row] = await tx
    .update(contractTemplates)
    .set(values)
    .where(and(eq(contractTemplates.id, id), eq(contractTemplates.companyId, companyId), isNull(contractTemplates.deletedAt)))
    .returning();
  return row;
}

export interface TemplateClauseWithTitle extends ContractTemplateClauseRow {
  clauseTitle: string;
  clauseCode: string;
  divisionId: string | null;
  category: "general_tc" | "division_specific";
}

/** Joined with `clauses` so the template-editor UI and assembly's "load template defaults" both get the clause's own title/code without a second round trip. */
export async function listTemplateClauses(tx: TenantTx, companyId: string, templateId: string): Promise<TemplateClauseWithTitle[]> {
  const rows = await tx
    .select({
      id: contractTemplateClauses.id,
      templateId: contractTemplateClauses.templateId,
      companyId: contractTemplateClauses.companyId,
      clauseId: contractTemplateClauses.clauseId,
      isMandatory: contractTemplateClauses.isMandatory,
      sortOrder: contractTemplateClauses.sortOrder,
      createdAt: contractTemplateClauses.createdAt,
      updatedAt: contractTemplateClauses.updatedAt,
      createdBy: contractTemplateClauses.createdBy,
      updatedBy: contractTemplateClauses.updatedBy,
      deletedAt: contractTemplateClauses.deletedAt,
      version: contractTemplateClauses.version,
      clauseTitle: clauses.clauseTitle,
      clauseCode: clauses.clauseCode,
      divisionId: clauses.divisionId,
      category: clauses.category,
    })
    .from(contractTemplateClauses)
    .innerJoin(clauses, eq(clauses.id, contractTemplateClauses.clauseId))
    .where(
      and(
        eq(contractTemplateClauses.templateId, templateId),
        eq(contractTemplateClauses.companyId, companyId),
        isNull(contractTemplateClauses.deletedAt),
      ),
    )
    .orderBy(asc(contractTemplateClauses.sortOrder));
  return rows;
}

export async function insertTemplateClause(tx: TenantTx, values: ContractTemplateClauseInsert): Promise<ContractTemplateClauseRow> {
  const [row] = await tx.insert(contractTemplateClauses).values(values).returning();
  if (!row) {
    throw new Error("failed to insert contract template clause");
  }
  return row;
}

export async function removeTemplateClause(tx: TenantTx, companyId: string, templateId: string, clauseId: string): Promise<boolean> {
  const [row] = await tx
    .update(contractTemplateClauses)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(contractTemplateClauses.templateId, templateId),
        eq(contractTemplateClauses.clauseId, clauseId),
        eq(contractTemplateClauses.companyId, companyId),
        isNull(contractTemplateClauses.deletedAt),
      ),
    )
    .returning();
  return row !== undefined;
}
