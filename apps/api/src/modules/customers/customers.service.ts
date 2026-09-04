import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import type { CreateCustomerInput, CustomersListQuery, CustomersOptionsQuery, UpdateCustomerInput } from "./customers.validator.js";
import {
  findCustomerByName,
  findCustomerById,
  insertCustomer,
  insertCustomerBanks,
  insertCustomerContacts,
  listActiveCustomerOptions,
  listBanksForCustomer,
  listContactsForCustomer,
  listCustomers,
  softDeleteBanksForCustomer,
  softDeleteContactsForCustomer,
  softDeleteCustomer,
  updateCustomer,
  type CustomerBankRow,
  type CustomerContactRow,
  type CustomerRow,
} from "./customers.repository.js";

export interface CustomerWithRelations extends CustomerRow {
  contacts: CustomerContactRow[];
  banks: CustomerBankRow[];
}

export interface CustomerOption {
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

async function attachRelations(tx: TenantTx, companyId: string, customer: CustomerRow): Promise<CustomerWithRelations> {
  const [contacts, banks] = await Promise.all([
    listContactsForCustomer(tx, companyId, customer.id),
    listBanksForCustomer(tx, companyId, customer.id),
  ]);
  return { ...customer, contacts, banks };
}

export async function list(ctx: RequestContext, params: CustomersListQuery): Promise<PaginatedRows<CustomerRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listCustomers(tx, scope.companyId, params));
}

export async function listOptions(ctx: RequestContext, params: CustomersOptionsQuery): Promise<CustomerOption[]> {
  const scope = requireTenantScope(ctx);
  const rows = await withTenantDb(ctx, (tx) => listActiveCustomerOptions(tx, scope.companyId, params.search));
  return rows.map((row) => ({ value: row.id, label: row.name, code: row.code }));
}

export async function getById(ctx: RequestContext, id: string): Promise<CustomerWithRelations> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const customer = await findCustomerById(tx, scope.companyId, id);
    if (!customer) {
      throw new NotFoundError("Customer not found");
    }
    return attachRelations(tx, scope.companyId, customer);
  });
}

export async function create(ctx: RequestContext, input: CreateCustomerInput): Promise<CustomerWithRelations> {
  const scope = requireTenantScope(ctx);
  const { contacts = [], banks = [], ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findCustomerByName(tx, scope.companyId, header.name);
    if (existing) {
      throw new ConflictError(`A customer named "${header.name}" already exists`);
    }

    const code = await nextNumber(tx, {
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      docType: "CUSTOMER",
      date: new Date(),
    });

    const customer = await insertCustomer(tx, {
      ...header,
      code,
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      createdBy: scope.userId,
    });

    const [insertedContacts, insertedBanks] = await Promise.all([
      insertCustomerContacts(
        tx,
        contacts.map((contact) => ({
          ...contact,
          customerId: customer.id,
          companyId: scope.companyId,
          createdBy: scope.userId,
        })),
      ),
      insertCustomerBanks(
        tx,
        banks.map((bank) => ({
          ...bank,
          customerId: customer.id,
          companyId: scope.companyId,
          createdBy: scope.userId,
        })),
      ),
    ]);

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "customer",
      entityId: customer.id,
      action: "customers.customer.created",
      after: { ...header, code },
    });

    return { ...customer, contacts: insertedContacts, banks: insertedBanks };
  });
}

export async function update(ctx: RequestContext, id: string, input: UpdateCustomerInput): Promise<CustomerWithRelations> {
  const scope = requireTenantScope(ctx);
  const { contacts, banks, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findCustomerById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Customer not found");
    }

    if (header.name && header.name !== existing.name) {
      const nameOwner = await findCustomerByName(tx, scope.companyId, header.name, id);
      if (nameOwner) {
        throw new ConflictError(`A customer named "${header.name}" already exists`);
      }
    }

    let customer = existing;
    if (Object.keys(header).length > 0) {
      const updated = await updateCustomer(tx, scope.companyId, id, { ...header, updatedBy: scope.userId });
      if (!updated) {
        throw new NotFoundError("Customer not found");
      }
      customer = updated;
    }

    if (contacts !== undefined) {
      await softDeleteContactsForCustomer(tx, scope.companyId, id, scope.userId);
      await insertCustomerContacts(
        tx,
        contacts.map((contact) => ({ ...contact, customerId: id, companyId: scope.companyId, createdBy: scope.userId })),
      );
    }
    if (banks !== undefined) {
      await softDeleteBanksForCustomer(tx, scope.companyId, id, scope.userId);
      await insertCustomerBanks(
        tx,
        banks.map((bank) => ({ ...bank, customerId: id, companyId: scope.companyId, createdBy: scope.userId })),
      );
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "customer",
      entityId: id,
      action: "customers.customer.updated",
      before: pick(existing, Object.keys(header)),
      after: pick(customer, Object.keys(header)),
    });

    return attachRelations(tx, scope.companyId, customer);
  });
}

export async function setStatus(ctx: RequestContext, id: string, status: "active" | "inactive"): Promise<CustomerRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findCustomerById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Customer not found");
    }

    const row = await updateCustomer(tx, scope.companyId, id, { status, updatedBy: scope.userId });
    if (!row) {
      throw new NotFoundError("Customer not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "customer",
      entityId: id,
      action: status === "active" ? "customers.customer.activated" : "customers.customer.deactivated",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

/**
 * Soft delete (rule 8) - distinct from setStatus("inactive"). Deactivate is
 * a reversible status toggle - a deactivated customer's own record is still
 * fetchable and its name still reserved; this is a further, one-way step
 * that frees the customer's name back up (customers_company_id_name_key is
 * `where deleted_at is null`, not status-based) so a new customer can reuse
 * it. Exact mirror of suppliers.service.ts's remove().
 */
export async function remove(ctx: RequestContext, id: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  await withTenantDb(ctx, async (tx) => {
    const existing = await findCustomerById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Customer not found");
    }

    const row = await softDeleteCustomer(tx, scope.companyId, id, scope.userId);
    if (!row) {
      throw new NotFoundError("Customer not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "customer",
      entityId: id,
      action: "customers.customer.deleted",
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
