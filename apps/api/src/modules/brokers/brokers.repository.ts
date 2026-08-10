import { and, asc, eq, isNull, ne, or, ilike, sql } from "drizzle-orm";
import type { PaginatedRows } from "../../core/masters/types.js";
import type { TenantTx } from "../../database/get-db.js";
import { brokerBanks, brokerContacts, brokers } from "../../database/tenant/schema.js";

export type BrokerRow = typeof brokers.$inferSelect;
export type BrokerInsert = typeof brokers.$inferInsert;
export type BrokerContactRow = typeof brokerContacts.$inferSelect;
export type BrokerContactInsert = typeof brokerContacts.$inferInsert;
export type BrokerBankRow = typeof brokerBanks.$inferSelect;
export type BrokerBankInsert = typeof brokerBanks.$inferInsert;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface BrokersListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "active" | "inactive" | undefined;
}

export async function listBrokers(tx: TenantTx, companyId: string, params: BrokersListParams): Promise<PaginatedRows<BrokerRow>> {
  const conditions = [eq(brokers.companyId, companyId), isNull(brokers.deletedAt)];
  if (params.status) {
    conditions.push(eq(brokers.status, params.status));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const searchCondition = or(ilike(brokers.name, term), ilike(brokers.code, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx.select().from(brokers).where(where).orderBy(asc(brokers.name)).limit(params.pageSize).offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(brokers).where(where),
  ]);

  return { items: rows, total: totalRows[0]?.value ?? 0, page: params.page, pageSize: params.pageSize };
}

/** Active-only, unpaginated, sorted for display - powers the Purchase header's broker dropdown, never the admin list view. */
export async function listActiveBrokerOptions(tx: TenantTx, companyId: string, search: string | undefined): Promise<BrokerRow[]> {
  const conditions = [eq(brokers.companyId, companyId), isNull(brokers.deletedAt), eq(brokers.status, "active")];
  if (search) {
    const term = `%${search}%`;
    const searchCondition = or(ilike(brokers.name, term), ilike(brokers.code, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  return tx.select().from(brokers).where(and(...conditions)).orderBy(asc(brokers.name));
}

export async function findBrokerById(tx: TenantTx, companyId: string, id: string): Promise<BrokerRow | undefined> {
  const [row] = await tx
    .select()
    .from(brokers)
    .where(and(eq(brokers.id, id), eq(brokers.companyId, companyId), isNull(brokers.deletedAt)))
    .limit(1);
  return row;
}

/** Soft-delete-aware, exact match (matches the DB's own partial unique index on (company_id, name) where deleted_at is null). `excludeId` lets update() check without a broker colliding with itself. */
export async function findBrokerByName(tx: TenantTx, companyId: string, name: string, excludeId?: string): Promise<BrokerRow | undefined> {
  const conditions = [eq(brokers.companyId, companyId), eq(brokers.name, name), isNull(brokers.deletedAt)];
  if (excludeId) {
    conditions.push(ne(brokers.id, excludeId));
  }
  const [row] = await tx.select().from(brokers).where(and(...conditions)).limit(1);
  return row;
}

export async function insertBroker(tx: TenantTx, values: BrokerInsert): Promise<BrokerRow> {
  const [row] = await tx.insert(brokers).values(values).returning();
  if (!row) {
    throw new Error("failed to insert broker");
  }
  return row;
}

export async function updateBroker(
  tx: TenantTx,
  companyId: string,
  id: string,
  values: Record<string, unknown>,
): Promise<BrokerRow | undefined> {
  const [row] = await tx
    .update(brokers)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(brokers.id, id), eq(brokers.companyId, companyId), isNull(brokers.deletedAt)))
    .returning();
  return row;
}

/** True soft delete (rule 8) - distinct from status='inactive': only THIS frees the broker's name back up, since brokers_company_id_name_key is `where deleted_at is null`, not status-based. */
export async function softDeleteBroker(tx: TenantTx, companyId: string, id: string, deletedBy: string): Promise<BrokerRow | undefined> {
  const [row] = await tx
    .update(brokers)
    .set({ deletedAt: new Date(), updatedBy: deletedBy, updatedAt: new Date() })
    .where(and(eq(brokers.id, id), eq(brokers.companyId, companyId), isNull(brokers.deletedAt)))
    .returning();
  return row;
}

export async function listContactsForBroker(tx: TenantTx, companyId: string, brokerId: string): Promise<BrokerContactRow[]> {
  return tx
    .select()
    .from(brokerContacts)
    .where(and(eq(brokerContacts.brokerId, brokerId), eq(brokerContacts.companyId, companyId), isNull(brokerContacts.deletedAt)))
    .orderBy(asc(brokerContacts.createdAt));
}

export async function listBanksForBroker(tx: TenantTx, companyId: string, brokerId: string): Promise<BrokerBankRow[]> {
  return tx
    .select()
    .from(brokerBanks)
    .where(and(eq(brokerBanks.brokerId, brokerId), eq(brokerBanks.companyId, companyId), isNull(brokerBanks.deletedAt)))
    .orderBy(asc(brokerBanks.createdAt));
}

export async function insertBrokerContacts(tx: TenantTx, values: BrokerContactInsert[]): Promise<BrokerContactRow[]> {
  if (values.length === 0) {
    return [];
  }
  return tx.insert(brokerContacts).values(values).returning();
}

export async function insertBrokerBanks(tx: TenantTx, values: BrokerBankInsert[]): Promise<BrokerBankRow[]> {
  if (values.length === 0) {
    return [];
  }
  return tx.insert(brokerBanks).values(values).returning();
}

/** Replaces a broker's contact list (update()'s "whole collection replace" semantics - see brokers.validator.ts's doc comment on `contacts`). No hard delete (rule 8). */
export async function softDeleteContactsForBroker(tx: TenantTx, companyId: string, brokerId: string, updatedBy: string): Promise<void> {
  await tx
    .update(brokerContacts)
    .set({ deletedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(brokerContacts.brokerId, brokerId), eq(brokerContacts.companyId, companyId), isNull(brokerContacts.deletedAt)));
}

export async function softDeleteBanksForBroker(tx: TenantTx, companyId: string, brokerId: string, updatedBy: string): Promise<void> {
  await tx
    .update(brokerBanks)
    .set({ deletedAt: new Date(), updatedBy, updatedAt: new Date() })
    .where(and(eq(brokerBanks.brokerId, brokerId), eq(brokerBanks.companyId, companyId), isNull(brokerBanks.deletedAt)));
}
