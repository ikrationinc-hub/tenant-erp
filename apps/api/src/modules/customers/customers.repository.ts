import { and, asc, eq, isNull, ne, or, ilike, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { customerBanks, customerContacts, customers } from "../../database/tenant/schema.js";

export type CustomerRow = typeof customers.$inferSelect;
export type CustomerInsert = typeof customers.$inferInsert;
export type CustomerContactRow = typeof customerContacts.$inferSelect;
export type CustomerContactInsert = typeof customerContacts.$inferInsert;
export type CustomerBankRow = typeof customerBanks.$inferSelect;
export type CustomerBankInsert = typeof customerBanks.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. Exact structural mirror of suppliers.repository.ts. */

export interface CustomersListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "active" | "inactive" | undefined;
}

export async function listCustomers(
  tx: TenantTx,
  companyId: string,
  params: CustomersListParams,
): Promise<PaginatedRows<CustomerRow>> {
  const conditions = [eq(customers.companyId, companyId), isNull(customers.deletedAt)];
  if (params.status) {
    conditions.push(eq(customers.status, params.status));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const searchCondition = or(ilike(customers.name, term), ilike(customers.code, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(customers).where(where).orderBy(asc(customers.name)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(customers).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

/** Active-only, unpaginated, sorted for display - powers every Dropdown->Customer field (e.g. Contract party selection, Purchase's reservedCustomerId), never the admin list view. */
export async function listActiveCustomerOptions(
  tx: TenantTx,
  companyId: string,
  search: string | undefined,
): Promise<CustomerRow[]> {
  const conditions = [eq(customers.companyId, companyId), isNull(customers.deletedAt), eq(customers.status, "active")];
  if (search) {
    const term = `%${search}%`;
    const searchCondition = or(ilike(customers.name, term), ilike(customers.code, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  return tx.select().from(customers).where(and(...conditions)).orderBy(asc(customers.name));
}

export async function findCustomerById(tx: TenantTx, companyId: string, id: string): Promise<CustomerRow | undefined> {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.companyId, companyId), isNull(customers.deletedAt)))
    .limit(1);
  return row;
}

/** Soft-delete-aware, exact match (matches the DB's own partial unique index on (company_id, name) where deleted_at is null). `excludeId` lets update() check without a customer colliding with itself. */
export async function findCustomerByName(
  tx: TenantTx,
  companyId: string,
  name: string,
  excludeId?: string,
): Promise<CustomerRow | undefined> {
  const conditions = [eq(customers.companyId, companyId), eq(customers.name, name), isNull(customers.deletedAt)];
  if (excludeId) {
    conditions.push(ne(customers.id, excludeId));
  }
  const [row] = await tx.select().from(customers).where(and(...conditions)).limit(1);
  return row;
}

export async function insertCustomer(tx: TenantTx, values: CustomerInsert): Promise<CustomerRow> {
  const [row] = await tx.insert(customers).values(values).returning();
  if (!row) {
    throw new Error("failed to insert customer");
  }
  return row;
}

export async function updateCustomer(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<CustomerRow | undefined> {
  const [row] = await tx
    .update(customers)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.companyId, companyId), isNull(customers.deletedAt)))
    .returning();
  return row;
}

/** True soft delete (rule 8) - distinct from status='inactive' (setStatus): only THIS frees the customer's name back up, since customers_company_id_name_key is `where deleted_at is null`, not status-based. */
export async function softDeleteCustomer(
  tx: TenantTx,
  companyId: string,
  id: string,
  deletedBy: string,
): Promise<CustomerRow | undefined> {
  const [row] = await tx
    .update(customers)
    .set({ deletedAt: new Date(), updatedBy: deletedBy, updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.companyId, companyId), isNull(customers.deletedAt)))
    .returning();
  return row;
}

export async function listContactsForCustomer(tx: TenantTx, companyId: string, customerId: string): Promise<CustomerContactRow[]> {
  return tx
    .select()
    .from(customerContacts)
    .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.companyId, companyId), isNull(customerContacts.deletedAt)))
    .orderBy(asc(customerContacts.createdAt));
}

export async function listBanksForCustomer(tx: TenantTx, companyId: string, customerId: string): Promise<CustomerBankRow[]> {
  return tx
    .select()
    .from(customerBanks)
    .where(and(eq(customerBanks.customerId, customerId), eq(customerBanks.companyId, companyId), isNull(customerBanks.deletedAt)))
    .orderBy(asc(customerBanks.createdAt));
}

export async function insertCustomerContacts(tx: TenantTx, values: CustomerContactInsert[]): Promise<CustomerContactRow[]> {
  if (values.length === 0) {
    return [];
  }
  return tx.insert(customerContacts).values(values).returning();
}

export async function insertCustomerBanks(tx: TenantTx, values: CustomerBankInsert[]): Promise<CustomerBankRow[]> {
  if (values.length === 0) {
    return [];
  }
  return tx.insert(customerBanks).values(values).returning();
}

/** Replaces a customer's contact list (update()'s "whole collection replace" semantics - see customers.validator.ts's doc comment). No hard delete (rule 8). */
export async function softDeleteContactsForCustomer(
  tx: TenantTx,
  companyId: string,
  customerId: string,
  updatedBy: string,
): Promise<void> {
  await tx
    .update(customerContacts)
    .set({ deletedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.companyId, companyId), isNull(customerContacts.deletedAt)));
}

export async function softDeleteBanksForCustomer(
  tx: TenantTx,
  companyId: string,
  customerId: string,
  updatedBy: string,
): Promise<void> {
  await tx
    .update(customerBanks)
    .set({ deletedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(customerBanks.customerId, customerId), eq(customerBanks.companyId, companyId), isNull(customerBanks.deletedAt)));
}
