import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../../core/audit/write.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { nextNumber } from "../../core/numbering/next-number.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import type { CreateSupplierInput, SuppliersListQuery, SuppliersOptionsQuery, UpdateSupplierInput } from "./suppliers.validator.js";
import {
  findSupplierByName,
  findSupplierById,
  insertSupplier,
  insertSupplierBanks,
  insertSupplierContacts,
  listActiveSupplierOptions,
  listBanksForSupplier,
  listContactsForSupplier,
  listSuppliers,
  softDeleteBanksForSupplier,
  softDeleteContactsForSupplier,
  softDeleteSupplier,
  updateSupplier,
  type SupplierBankRow,
  type SupplierContactRow,
  type SupplierRow,
} from "./suppliers.repository.js";

export interface SupplierWithRelations extends SupplierRow {
  contacts: SupplierContactRow[];
  banks: SupplierBankRow[];
}

export interface SupplierOption {
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

async function attachRelations(tx: TenantTx, companyId: string, supplier: SupplierRow): Promise<SupplierWithRelations> {
  const [contacts, banks] = await Promise.all([
    listContactsForSupplier(tx, companyId, supplier.id),
    listBanksForSupplier(tx, companyId, supplier.id),
  ]);
  return { ...supplier, contacts, banks };
}

export async function list(ctx: RequestContext, params: SuppliersListQuery): Promise<PaginatedRows<SupplierRow>> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, (tx) => listSuppliers(tx, scope.companyId, params));
}

export async function listOptions(ctx: RequestContext, params: SuppliersOptionsQuery): Promise<SupplierOption[]> {
  const scope = requireTenantScope(ctx);
  const rows = await withTenantDb(ctx, (tx) => listActiveSupplierOptions(tx, scope.companyId, params.search));
  return rows.map((row) => ({ value: row.id, label: row.name, code: row.code }));
}

export async function getById(ctx: RequestContext, id: string): Promise<SupplierWithRelations> {
  const scope = requireTenantScope(ctx);
  return withTenantDb(ctx, async (tx) => {
    const supplier = await findSupplierById(tx, scope.companyId, id);
    if (!supplier) {
      throw new NotFoundError("Supplier not found");
    }
    return attachRelations(tx, scope.companyId, supplier);
  });
}

/** FR-001/FR-002/FR-005. */
export async function create(ctx: RequestContext, input: CreateSupplierInput): Promise<SupplierWithRelations> {
  const scope = requireTenantScope(ctx);
  const { contacts = [], banks = [], ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findSupplierByName(tx, scope.companyId, header.name);
    if (existing) {
      throw new ConflictError(`A supplier named "${header.name}" already exists`);
    }

    const code = await nextNumber(tx, {
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      docType: "SUPPLIER",
      date: new Date(),
    });

    const supplier = await insertSupplier(tx, {
      ...header,
      code,
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      createdBy: scope.userId,
    });

    const [insertedContacts, insertedBanks] = await Promise.all([
      insertSupplierContacts(
        tx,
        contacts.map((contact) => ({
          ...contact,
          supplierId: supplier.id,
          companyId: scope.companyId,
          createdBy: scope.userId,
        })),
      ),
      insertSupplierBanks(
        tx,
        banks.map((bank) => ({
          ...bank,
          supplierId: supplier.id,
          companyId: scope.companyId,
          createdBy: scope.userId,
        })),
      ),
    ]);

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "supplier",
      entityId: supplier.id,
      action: "suppliers.supplier.created",
      after: { ...header, code },
    });

    return { ...supplier, contacts: insertedContacts, banks: insertedBanks };
  });
}

/** FR-003. */
export async function update(ctx: RequestContext, id: string, input: UpdateSupplierInput): Promise<SupplierWithRelations> {
  const scope = requireTenantScope(ctx);
  const { contacts, banks, ...header } = input;

  return withTenantDb(ctx, async (tx) => {
    const existing = await findSupplierById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Supplier not found");
    }

    if (header.name && header.name !== existing.name) {
      const nameOwner = await findSupplierByName(tx, scope.companyId, header.name, id);
      if (nameOwner) {
        throw new ConflictError(`A supplier named "${header.name}" already exists`);
      }
    }

    let supplier = existing;
    if (Object.keys(header).length > 0) {
      const updated = await updateSupplier(tx, scope.companyId, id, { ...header, updatedBy: scope.userId });
      if (!updated) {
        throw new NotFoundError("Supplier not found");
      }
      supplier = updated;
    }

    if (contacts !== undefined) {
      await softDeleteContactsForSupplier(tx, scope.companyId, id, scope.userId);
      await insertSupplierContacts(
        tx,
        contacts.map((contact) => ({ ...contact, supplierId: id, companyId: scope.companyId, createdBy: scope.userId })),
      );
    }
    if (banks !== undefined) {
      await softDeleteBanksForSupplier(tx, scope.companyId, id, scope.userId);
      await insertSupplierBanks(
        tx,
        banks.map((bank) => ({ ...bank, supplierId: id, companyId: scope.companyId, createdBy: scope.userId })),
      );
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "supplier",
      entityId: id,
      action: "suppliers.supplier.updated",
      before: pick(existing, Object.keys(header)),
      after: pick(supplier, Object.keys(header)),
    });

    return attachRelations(tx, scope.companyId, supplier);
  });
}

/** FR-004. */
export async function setStatus(ctx: RequestContext, id: string, status: "active" | "inactive"): Promise<SupplierRow> {
  const scope = requireTenantScope(ctx);

  return withTenantDb(ctx, async (tx) => {
    const existing = await findSupplierById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Supplier not found");
    }

    const row = await updateSupplier(tx, scope.companyId, id, { status, updatedBy: scope.userId });
    if (!row) {
      throw new NotFoundError("Supplier not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "supplier",
      entityId: id,
      action: status === "active" ? "suppliers.supplier.activated" : "suppliers.supplier.deactivated",
      before: { status: existing.status },
      after: { status: row.status },
    });

    return row;
  });
}

/**
 * Soft delete (rule 8) - distinct from setStatus("inactive"). Deactivate is
 * a reversible status toggle a deactivated supplier's own record is still
 * fetchable and its name still reserved; this is a further, one-way step
 * that frees the supplier's name back up (suppliers_company_id_name_key is
 * `where deleted_at is null`, not status-based) so a new supplier can reuse
 * it, matching FR-005's "never permanently reserved."
 */
export async function remove(ctx: RequestContext, id: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  await withTenantDb(ctx, async (tx) => {
    const existing = await findSupplierById(tx, scope.companyId, id);
    if (!existing) {
      throw new NotFoundError("Supplier not found");
    }

    const row = await softDeleteSupplier(tx, scope.companyId, id, scope.userId);
    if (!row) {
      throw new NotFoundError("Supplier not found");
    }

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "supplier",
      entityId: id,
      action: "suppliers.supplier.deleted",
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
