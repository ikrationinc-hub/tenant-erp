import { and, asc, eq, getTableName, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { TenantTx } from "../../database/get-db.js";
import type { MasterInsert, MasterListParams, MasterOptionsParams, MasterRow, MasterTable, PaginatedRows } from "./types.js";

/**
 * The repository half of the generic master-data pattern
 * (core/masters/factory.ts's defineMasterModule ties this together with
 * the service/controller/routes halves). Parameterized purely by the
 * Drizzle table object - no master-specific code lives here. Extra columns
 * a specific master has (cities.country_id, items.item_type) flow through
 * generically as MasterRow/MasterInsert's index signature; this file never
 * names them.
 *
 * `raw` exists because drizzle-orm's .from()/.insert()/.update() overload
 * resolution doesn't fully resolve when the table argument is a generic
 * type PARAMETER (T) rather than a concrete table - a known limitation of
 * this "one repository over many tables" shape, not a real type error in
 * this code (types.ts's doc comment on MasterRow has the same story for
 * why row results are typed as MasterRow, not InferSelectModel<T>).
 * Column REFERENCES (table.code, table.isActive, ...) stay fully typed
 * throughout; only the query-builder entry points use `raw`.
 */
export function createMasterRepository<T extends MasterTable>(table: T) {
  const raw = table as unknown as PgTable;

  function scopeConditions(companyId: string, extra: SQL[] = []): SQL[] {
    return [eq(table.companyId, companyId), isNull(table.deletedAt), ...extra];
  }

  async function list(
    tx: TenantTx,
    companyId: string,
    params: MasterListParams,
    extra: SQL[] = [],
  ): Promise<PaginatedRows<MasterRow>> {
    const conditions = scopeConditions(companyId, extra);
    if (params.isActive !== undefined) {
      conditions.push(eq(table.isActive, params.isActive));
    }
    if (params.search) {
      const term = `%${params.search}%`;
      const searchCondition = or(ilike(table.name, term), ilike(table.code, term));
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const where = and(...conditions);
    const offset = (params.page - 1) * params.pageSize;

    const [rows, totalRows] = await Promise.all([
      tx
        .select()
        .from(raw)
        .where(where)
        .orderBy(asc(table.sortOrder), asc(table.name))
        .limit(params.pageSize)
        .offset(offset),
      tx.select({ value: sql<number>`count(*)::int` }).from(raw).where(where),
    ]);

    return {
      items: rows as MasterRow[],
      total: totalRows[0]?.value ?? 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  /** Active-only, unpaginated, sorted for display - powers a dropdown (GET /api/v1/masters/:master/options), never the admin list view. */
  async function listOptions(
    tx: TenantTx,
    companyId: string,
    params: MasterOptionsParams,
    extra: SQL[] = [],
  ): Promise<MasterRow[]> {
    const conditions = [...scopeConditions(companyId, extra), eq(table.isActive, true)];
    if (params.search) {
      const term = `%${params.search}%`;
      const searchCondition = or(ilike(table.name, term), ilike(table.code, term));
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const rows = await tx
      .select()
      .from(raw)
      .where(and(...conditions))
      .orderBy(asc(table.sortOrder), asc(table.name));
    return rows as MasterRow[];
  }

  async function findById(tx: TenantTx, companyId: string, id: string): Promise<MasterRow | undefined> {
    const [row] = await tx
      .select()
      .from(raw)
      .where(and(eq(table.id, id), eq(table.companyId, companyId), isNull(table.deletedAt)))
      .limit(1);
    return row as MasterRow | undefined;
  }

  async function findByCode(tx: TenantTx, companyId: string, code: string): Promise<MasterRow | undefined> {
    const [row] = await tx
      .select()
      .from(raw)
      .where(and(eq(table.code, code), eq(table.companyId, companyId), isNull(table.deletedAt)))
      .limit(1);
    return row as MasterRow | undefined;
  }

  async function insert(tx: TenantTx, values: MasterInsert): Promise<MasterRow> {
    const [row] = await tx.insert(raw).values(values).returning();
    if (!row) {
      throw new Error(`failed to insert row into ${getTableName(table)}`);
    }
    return row as MasterRow;
  }

  async function update(
    tx: TenantTx,
    companyId: string,
    id: string,
    values: Partial<MasterInsert>,
  ): Promise<MasterRow | undefined> {
    const [row] = await tx
      .update(raw)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(table.id, id), eq(table.companyId, companyId), isNull(table.deletedAt)))
      .returning();
    return row as MasterRow | undefined;
  }

  return { table, list, listOptions, findById, findByCode, insert, update };
}

export type MasterRepository<T extends MasterTable> = ReturnType<typeof createMasterRepository<T>>;
