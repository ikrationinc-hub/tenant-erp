import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

/**
 * The columns every table built by database/tenant/schema.ts's
 * defineMasterTable() has - the structural contract createMasterRepository
 * (repository.ts) and everything built on top of it depends on. Any
 * concrete master table (countries, cities, items, ...) satisfies this
 * automatically; extra columns (cities' country_id, items' item_type) live
 * outside this shape and are handled generically via InferInsertModel/
 * InferSelectModel, never named here.
 */
export interface MasterTableShape {
  id: AnyPgColumn;
  companyId: AnyPgColumn;
  branchId: AnyPgColumn;
  code: AnyPgColumn;
  name: AnyPgColumn;
  isActive: AnyPgColumn;
  sortOrder: AnyPgColumn;
  createdAt: AnyPgColumn;
  updatedAt: AnyPgColumn;
  createdBy: AnyPgColumn;
  updatedBy: AnyPgColumn;
  deletedAt: AnyPgColumn;
  version: AnyPgColumn;
}

export type MasterTable = PgTable & MasterTableShape;

/**
 * A master row's shape at the repository/service layer: the fixed columns
 * every master has, typed precisely, plus an index signature for whatever
 * extra columns that specific master adds (cities.country_id,
 * items.item_type). Deliberately NOT `InferSelectModel<T>` for a generic
 * T - drizzle-orm's InferSelectModel relies on a table's own internal
 * config branding, which a generic `T extends MasterTable` type parameter
 * doesn't carry (only a REAL, concrete table like `typeof cities` does) -
 * see repository.ts's doc comment. Per-master extra-column type safety is
 * enforced instead at the Zod validator layer (registry.ts's per-master
 * create/update schemas) and in the concrete closures a master itself
 * supplies (buildParentFilter/extractParentValue), not here.
 */
export interface MasterRow {
  id: string;
  companyId: string;
  branchId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string | null;
  deletedAt: Date | null;
  version: number;
  [extraColumn: string]: unknown;
}

/** What create()/update() accept - companyId/createdBy/updatedBy/id/timestamps are populated by the service, never the caller. */
export interface MasterInsert {
  code: string;
  name: string;
  isActive?: boolean;
  sortOrder?: number;
  companyId: string;
  createdBy: string;
  [extraColumn: string]: unknown;
}

export interface PaginatedRows<TRow> {
  items: TRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MasterListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  isActive?: boolean | undefined;
  /** e.g. a country's id, when listing cities - only meaningful for a master with buildParentFilter configured (core/masters/service.ts). */
  parentValue?: string | undefined;
}

export interface MasterOptionsParams {
  search?: string | undefined;
  /** The value of the field this master's dropdown depends on, e.g. a selected country's id when listing cities. */
  parentValue?: string | undefined;
}

export interface MasterOption {
  value: string;
  label: string;
  parentValue?: string;
}
