import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import type { BrokersListQuery, BrokersOptionsQuery, CreateBrokerInput, UpdateBrokerInput } from "./brokers.validator.js";
import {
  findBrokerByName,
  findBrokerById,
  insertBroker,
  insertBrokerBanks,
  insertBrokerContacts,
  listActiveBrokerOptions,
  listBanksForBroker,
  listBrokers,
  listContactsForBroker,
  softDeleteBanksForBroker,
  softDeleteBroker,
  softDeleteContactsForBroker,
  updateBroker,
  type BrokerBankRow,
  type BrokerContactRow,
  type BrokerRow,
} from "./brokers.repository.js";

export interface BrokerWithRelations extends BrokerRow {
  contacts: BrokerContactRow[];
  banks: BrokerBankRow[];
}

export interface BrokerOption {
  value: string;
  label: string;
  code: string;
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

async function attachRelations(tx: TenantTx, companyId: string, broker: BrokerRow): Promise<BrokerWithRelations> {
  const [contacts, banks] = await Promise.all([
    listContactsForBroker(tx, companyId, broker.id),
    listBanksForBroker(tx, companyId, broker.id),
  ]);
  return { ...broker, contacts, banks };
}

export async function list(ctx: RequestContext, params: BrokersListQuery): Promise<PaginatedRows<BrokerRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listBrokers(tx, scope.companyId, params));
}

export async function listOptions(ctx: RequestContext, params: BrokersOptionsQuery): Promise<BrokerOption[]> {
  const scope = requireTenantScope(ctx);
  const rows = await withTenantDb(ctx, (tx) => listActiveBrokerOptions(tx, scope.companyId, params.search));
  return rows.map((row) => ({ value: row.id, label: row.name, code: row.code }));
}

export async function getById(ctx: RequestContext, id: string): Promise<BrokerWithRelations> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const broker = await findBrokerById(tx, scope.companyId, id);
    if (!broker) {
      throw new NotFoundError("Broker not found");
    }
    return attachRelations(tx, scope.companyId, broker);
  });
}

export async function create(ctx: RequestContext, input: CreateBrokerInput): Promise<BrokerWithRelations> {
  const scope = requireTenantScope(ctx);
  const { contacts = [], banks = [], ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findBrokerByName(tx, scope.companyId, header.name);
    if (existing) {
      throw new ConflictError(`A broker named "${header.name}" already exists`);
    }

    const code = await nextNumber(tx, {
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      docType: "BROKER",
      date: new Date(),
    });

    const broker = await insertBroker(tx, {
      ...header,
      code,
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      createdBy: scope.userId,
    });

    const [insertedContacts, insertedBanks] = await Promise.all([
      insertBrokerContacts(
        tx,
        contacts.map((contact) => ({ ...contact, brokerId: broker.id, companyId: scope.companyId, createdBy: scope.userId })),
      ),
      insertBrokerBanks(tx, banks.map((bank) => ({ ...bank, brokerId: broker.id, companyId: scope.companyId, createdBy: scope.userId }))),
    ]);

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "broker",
      entityId: broker.id,
      action: "brokers.broker.created",
      after: { ...header, code },
    });

    return { ...broker, contacts: insertedContacts, banks: insertedBanks };
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateBrokerInput): Promise<BrokerWithRelations> {
  const scope = requireTenantScope(ctx);
  const { contacts, banks, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findBrokerById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Broker not found");
    }

    if (header.name && header.name !== existing.name) {
      const nameOwner = await findBrokerByName(tx, scope.companyId, header.name, id);
      if (nameOwner) {
        throw new ConflictError(`A broker named "${header.name}" already exists`);
      }
    }

    let broker = existing;
    if (Object.keys(header).length > 0) {
      const updated = await updateBroker(tx, scope.companyId, id, { ...header, updatedBy: scope.userId });
      if (!updated) {
        throw new NotFoundError("Broker not found");
      }
      broker = updated;
    }

    if (contacts !== undefined) {
      await softDeleteContactsForBroker(tx, scope.companyId, id, scope.userId);
      await insertBrokerContacts(tx, contacts.map((contact) => ({ ...contact, brokerId: id, companyId: scope.companyId, createdBy: scope.userId })));
    }
    if (banks !== undefined) {
      await softDeleteBanksForBroker(tx, scope.companyId, id, scope.userId);
      await insertBrokerBanks(tx, banks.map((bank) => ({ ...bank, brokerId: id, companyId: scope.companyId, createdBy: scope.userId })));
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "broker",
      entityId: id,
      action: "brokers.broker.updated",
      before: pick(existing, Object.keys(header)),
      after: pick(broker, Object.keys(header)),
    });

    return attachRelations(tx, scope.companyId, broker);
  });
}

export async function setStatus(ctx: RequestContext, id: string, status: "active" | "inactive"): Promise<BrokerRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findBrokerById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Broker not found");
    }

    const row = await updateBroker(tx, scope.companyId, id, { status, updatedBy: scope.userId });
    if (!row) {
      throw new NotFoundError("Broker not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "broker",
      entityId: id,
      action: status === "active" ? "brokers.broker.activated" : "brokers.broker.deactivated",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

/** Soft delete (rule 8) - distinct from setStatus("inactive"), same reasoning as suppliers.service.ts's remove(): frees the broker's name back up for reuse. */
export async function remove(ctx: RequestContext, id: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  await withTenantDb(ctx, async (tx) => {
    const existing = await findBrokerById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Broker not found");
    }

    const row = await softDeleteBroker(tx, scope.companyId, id, scope.userId);
    if (!row) {
      throw new NotFoundError("Broker not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "broker",
      entityId: id,
      action: "brokers.broker.deleted",
      before: { deletedAt: null },
      after: { deletedAt: row.deletedAt },
    });
  });
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = source[key];
  }
  return result;
}
