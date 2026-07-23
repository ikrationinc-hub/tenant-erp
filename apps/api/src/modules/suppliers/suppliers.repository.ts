import { and, asc, eq, isNull, ne, or, ilike, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { supplierBanks, supplierContacts, suppliers } from "../../database/tenant/schema.js";

export type SupplierRow = typeof suppliers.$inferSelect;
export type SupplierInsert = typeof suppliers.$inferInsert;
export type SupplierContactRow = typeof supplierContacts.$inferSelect;
export type SupplierContactInsert = typeof supplierContacts.$inferInsert;
export type SupplierBankRow = typeof supplierBanks.$inferSelect;
export type SupplierBankInsert = typeof supplierBanks.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface SuppliersListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "active" | "inactive" | undefined;
}

export async function listSuppliers(
  tx: TenantTx,
  companyId: string,
  params: SuppliersListParams,
): Promise<PaginatedRows<SupplierRow>> {
  const conditions = [eq(suppliers.companyId, companyId), isNull(suppliers.deletedAt)];
  if (params.status) {
    conditions.push(eq(suppliers.status, params.status));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const searchCondition = or(ilike(suppliers.name, term), ilike(suppliers.code, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(suppliers).where(where).orderBy(asc(suppliers.name)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(suppliers).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

/** Active-only, unpaginated, sorted for display - powers a Purchase-module supplier dropdown (FR-006), never the admin list view. */
export async function listActiveSupplierOptions(
  tx: TenantTx,
  companyId: string,
  search: string | undefined,
): Promise<SupplierRow[]> {
  const conditions = [eq(suppliers.companyId, companyId), isNull(suppliers.deletedAt), eq(suppliers.status, "active")];
  if (search) {
    const term = `%${search}%`;
    const searchCondition = or(ilike(suppliers.name, term), ilike(suppliers.code, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  return tx.select().from(suppliers).where(and(...conditions)).orderBy(asc(suppliers.name));
}

export async function findSupplierById(tx: TenantTx, companyId: string, id: string): Promise<SupplierRow | undefined> {
  const [row] = await tx
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.companyId, companyId), isNull(suppliers.deletedAt)))
    .limit(1);
  return row;
}

/** FR-005: soft-delete-aware, exact match (matches the DB's own partial unique index on (company_id, name) where deleted_at is null). `excludeId` lets update() check without a supplier colliding with itself. */
export async function findSupplierByName(
  tx: TenantTx,
  companyId: string,
  name: string,
  excludeId?: string,
): Promise<SupplierRow | undefined> {
  const conditions = [eq(suppliers.companyId, companyId), eq(suppliers.name, name), isNull(suppliers.deletedAt)];
  if (excludeId) {
    conditions.push(ne(suppliers.id, excludeId));
  }
  const [row] = await tx.select().from(suppliers).where(and(...conditions)).limit(1);
  return row;
}

export async function insertSupplier(tx: TenantTx, values: SupplierInsert): Promise<SupplierRow> {
  const [row] = await tx.insert(suppliers).values(values).returning();
  if (!row) {
    throw new Error("failed to insert supplier");
  }
  return row;
}

export async function updateSupplier(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<SupplierRow | undefined> {
  const [row] = await tx
    .update(suppliers)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.companyId, companyId), isNull(suppliers.deletedAt)))
    .returning();
  return row;
}

/** True soft delete (rule 8) - distinct from status='inactive' (setStatus): only THIS frees the supplier's name back up, since suppliers_company_id_name_key is `where deleted_at is null`, not status-based. */
export async function softDeleteSupplier(
  tx: TenantTx,
  companyId: string,
  id: string,
  deletedBy: string,
): Promise<SupplierRow | undefined> {
  const [row] = await tx
    .update(suppliers)
    .set({ deletedAt: new Date(), updatedBy: deletedBy, updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.companyId, companyId), isNull(suppliers.deletedAt)))
    .returning();
  return row;
}

export async function listContactsForSupplier(tx: TenantTx, companyId: string, supplierId: string): Promise<SupplierContactRow[]> {
  return tx
    .select()
    .from(supplierContacts)
    .where(and(eq(supplierContacts.supplierId, supplierId), eq(supplierContacts.companyId, companyId), isNull(supplierContacts.deletedAt)))
    .orderBy(asc(supplierContacts.createdAt));
}

export async function listBanksForSupplier(tx: TenantTx, companyId: string, supplierId: string): Promise<SupplierBankRow[]> {
  return tx
    .select()
    .from(supplierBanks)
    .where(and(eq(supplierBanks.supplierId, supplierId), eq(supplierBanks.companyId, companyId), isNull(supplierBanks.deletedAt)))
    .orderBy(asc(supplierBanks.createdAt));
}

export async function insertSupplierContacts(tx: TenantTx, values: SupplierContactInsert[]): Promise<SupplierContactRow[]> {
  if (values.length === 0) {
    return [];
  }
  return tx.insert(supplierContacts).values(values).returning();
}

export async function insertSupplierBanks(tx: TenantTx, values: SupplierBankInsert[]): Promise<SupplierBankRow[]> {
  if (values.length === 0) {
    return [];
  }
  return tx.insert(supplierBanks).values(values).returning();
}

/** Replaces a supplier's contact list (update()'s "whole collection replace" semantics - see suppliers.validator.ts's doc comment on `contacts`). No hard delete (rule 8). */
export async function softDeleteContactsForSupplier(
  tx: TenantTx,
  companyId: string,
  supplierId: string,
  updatedBy: string,
): Promise<void> {
  await tx
    .update(supplierContacts)
    .set({ deletedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(supplierContacts.supplierId, supplierId), eq(supplierContacts.companyId, companyId), isNull(supplierContacts.deletedAt)));
}

export async function softDeleteBanksForSupplier(
  tx: TenantTx,
  companyId: string,
  supplierId: string,
  updatedBy: string,
): Promise<void> {
  await tx
    .update(supplierBanks)
    .set({ deletedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(supplierBanks.supplierId, supplierId), eq(supplierBanks.companyId, companyId), isNull(supplierBanks.deletedAt)));
}
