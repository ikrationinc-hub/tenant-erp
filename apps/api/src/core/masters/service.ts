import type { SQL } from "drizzle-orm";
import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { insertAuditLog } from "../audit/write.js";
import { withTenantDb } from "../../database/get-db.js";
import type { MasterRepository } from "./repository.js";
import type {
  MasterListParams,
  MasterOption,
  MasterOptionsParams,
  MasterRow,
  MasterTable,
  PaginatedRows,
} from "./types.js";

export interface MasterServiceConfig<T extends MasterTable> {
  /** e.g. "country" - used for permission keys (masters.<entity>.<action>), audit entity, and error messages. */
  entity: string;
  repository: MasterRepository<T>;
  /** cities: (parentValue) => [eq(cities.countryId, parentValue)] - filters listOptions by the dropdown this one cascades from. */
  buildParentFilter?: (parentValue: string) => SQL[];
  /** cities: (row) => row.countryId as string - the value returned alongside each option so the frontend can group/filter client-side too. */
  extractParentValue?: (row: MasterRow) => string | undefined;
}

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

/**
 * The service half of the generic master-data pattern
 * (core/masters/factory.ts's defineMasterModule wires this to a concrete
 * table's repository). CRUD + activate/deactivate + search + pagination +
 * audit, all table-agnostic - a specific master's only say in behavior is
 * its `entity` name and (for a master with a parent, like cities) its
 * cascading-filter functions.
 *
 * `input` is Zod-validated by the caller (core/masters/controller.ts,
 * built for this exact same table in the same defineMasterModule call)
 * against a schema whose shape mirrors this table's own extra columns, so
 * spreading it into MasterInsert here is safe even though this generic
 * layer can't see those extra columns by name.
 */
export function createMasterService<T extends MasterTable>(config: MasterServiceConfig<T>) {
  const { entity, repository } = config;

  function toOption(row: MasterRow): MasterOption {
    const parentValue = config.extractParentValue?.(row);
    return {
      value: row.id,
      label: row.name,
      ...(parentValue !== undefined ? { parentValue } : {}),
    };
  }

  async function list(ctx: RequestContext, params: MasterListParams): Promise<PaginatedRows<MasterRow>> {
    const scope = requireTenantScope(ctx);
    const extra = params.parentValue && config.buildParentFilter ? config.buildParentFilter(params.parentValue) : [];
    return withTenantDb(ctx, (tx) => repository.list(tx, scope.companyId, params, extra));
  }

  async function listOptions(ctx: RequestContext, params: MasterOptionsParams): Promise<MasterOption[]> {
    const scope = requireTenantScope(ctx);
    const extra = params.parentValue && config.buildParentFilter ? config.buildParentFilter(params.parentValue) : [];
    const rows = await withTenantDb(ctx, (tx) => repository.listOptions(tx, scope.companyId, params, extra));
    return rows.map(toOption);
  }

  async function getById(ctx: RequestContext, id: string): Promise<MasterRow> {
    const scope = requireTenantScope(ctx);
    const row = await withTenantDb(ctx, (tx) => repository.findById(tx, scope.companyId, id));
    if (!row) {
      throw new NotFoundError(`${entity} not found`);
    }
    return row;
  }

  async function create(
    ctx: RequestContext,
    input: Record<string, unknown> & { code: string; name: string },
  ): Promise<MasterRow> {
    const scope = requireTenantScope(ctx);

    return withTenantDb(ctx, async (tx) => {
      const existing = await repository.findByCode(tx, scope.companyId, input.code);
      if (existing) {
        throw new ConflictError(`A ${entity} with code "${input.code}" already exists`);
      }

      const row = await repository.insert(tx, {
        ...input,
        companyId: scope.companyId,
        createdBy: scope.userId,
      });

      await insertAuditLog(tx, {
        companyId: scope.companyId,
        changedBy: scope.userId,
        entity: `masters.${entity}`,
        entityId: row.id,
        action: `masters.${entity}.created`,
        after: input,
      });

      return row;
    });
  }

  async function update(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<MasterRow> {
    const scope = requireTenantScope(ctx);

    return withTenantDb(ctx, async (tx) => {
      const existing = await repository.findById(tx, scope.companyId, id);
      if (!existing) {
        throw new NotFoundError(`${entity} not found`);
      }

      if (typeof input.code === "string" && input.code !== existing.code) {
        const codeOwner = await repository.findByCode(tx, scope.companyId, input.code);
        if (codeOwner && codeOwner.id !== id) {
          throw new ConflictError(`A ${entity} with code "${input.code}" already exists`);
        }
      }

      const row = await repository.update(tx, scope.companyId, id, {
        ...input,
        updatedBy: scope.userId,
      });
      if (!row) {
        throw new NotFoundError(`${entity} not found`);
      }

      const keys = Object.keys(input);
      await insertAuditLog(tx, {
        companyId: scope.companyId,
        changedBy: scope.userId,
        entity: `masters.${entity}`,
        entityId: id,
        action: `masters.${entity}.updated`,
        before: pick(existing, keys),
        after: pick(row, keys),
      });

      return row;
    });
  }

  async function setActive(ctx: RequestContext, id: string, isActive: boolean): Promise<MasterRow> {
    const scope = requireTenantScope(ctx);

    return withTenantDb(ctx, async (tx) => {
      const existing = await repository.findById(tx, scope.companyId, id);
      if (!existing) {
        throw new NotFoundError(`${entity} not found`);
      }

      const row = await repository.update(tx, scope.companyId, id, {
        isActive,
        updatedBy: scope.userId,
      });
      if (!row) {
        throw new NotFoundError(`${entity} not found`);
      }

      await insertAuditLog(tx, {
        companyId: scope.companyId,
        changedBy: scope.userId,
        entity: `masters.${entity}`,
        entityId: id,
        action: isActive ? `masters.${entity}.activated` : `masters.${entity}.deactivated`,
        before: { isActive: existing.isActive },
        after: { isActive: row.isActive },
      });

      return row;
    });
  }

  return { list, listOptions, getById, create, update, setActive };
}

function pick(source: MasterRow, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = source[key];
  }
  return result;
}
