import type { SQL } from "drizzle-orm";
import type { RequestHandler, Router } from "express";
import type { z } from "zod";
import type { FieldDataType, FieldDefault } from "../field-engine/types.js";
import { permissionEntry, type PermissionCatalogueEntry } from "../rbac/types.js";
import { createMasterController } from "./controller.js";
import { createMasterRepository } from "./repository.js";
import { createMasterRouter } from "./routes.js";
import { createMasterService } from "./service.js";
import type { MasterRow, MasterTable } from "./types.js";

export interface MasterExtraFieldDefault {
  fieldKey: string;
  label: string;
  dataType: FieldDataType;
  isMandatory?: boolean;
  optionsSource?: string;
}

export interface DefineMasterModuleConfig<
  T extends MasterTable,
  TCreate extends Record<string, unknown> & { code: string; name: string },
  TUpdate extends Record<string, unknown>,
> {
  /** e.g. "country" - the permission/audit/field-engine entity key. */
  entity: string;
  /** e.g. "countries" - the URL segment this master mounts at, and the :master value GET /api/v1/masters/:master/options dispatches on. */
  urlSegment: string;
  table: T;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  /** cities: (parentValue) => [eq(cities.countryId, parentValue)] */
  buildParentFilter?: (parentValue: string) => SQL[];
  /** cities: (row) => row.countryId as string */
  extractParentValue?: (row: MasterRow) => string | undefined;
  /** Extra Tier-2 field descriptors beyond the base code/name/isActive every master gets automatically (e.g. cities' countryId, items' itemType). */
  extraFieldDefaults?: MasterExtraFieldDefault[];
}

export interface MasterModule {
  entity: string;
  urlSegment: string;
  router: Router;
  /** The GET .../options handler, mounted separately by registry.ts at the shared GET /api/v1/masters/:master/options route (dispatched by urlSegment), not nested under `router`. */
  listOptions: RequestHandler;
  permissions: PermissionCatalogueEntry[];
  fieldDefaults: FieldDefault[];
}

function buildFieldDefaults(entity: string, extra: MasterExtraFieldDefault[]): FieldDefault[] {
  const base: FieldDefault[] = [
    {
      module: "masters",
      entity,
      fieldKey: "code",
      label: "Code",
      dataType: "text",
      isVisible: true,
      isMandatory: true,
      isEditable: true,
      sortOrder: 0,
      isSystem: true,
    },
    {
      module: "masters",
      entity,
      fieldKey: "name",
      label: "Name",
      dataType: "text",
      isVisible: true,
      isMandatory: true,
      isEditable: true,
      sortOrder: 1,
      isSystem: true,
    },
    {
      module: "masters",
      entity,
      fieldKey: "isActive",
      label: "Active",
      dataType: "boolean",
      isVisible: true,
      isMandatory: false,
      isEditable: true,
      sortOrder: 2,
      isSystem: false,
    },
  ];

  const extraDefaults: FieldDefault[] = extra.map((field, index) => ({
    module: "masters",
    entity,
    fieldKey: field.fieldKey,
    label: field.label,
    dataType: field.dataType,
    isVisible: true,
    isMandatory: field.isMandatory ?? false,
    isEditable: true,
    sortOrder: 3 + index,
    isSystem: false,
    ...(field.optionsSource !== undefined ? { optionsSource: field.optionsSource } : {}),
  }));

  return [...base, ...extraDefaults];
}

/**
 * The one call that instantiates the generic master-data pattern for a
 * concrete table: repository + service + controller + router +
 * permissions + field-engine defaults, all in one place. Every master in
 * core/masters/registry.ts is exactly one call to this function - if
 * instantiating a 16th master ever needs more than a call here, that's a
 * sign the pattern stopped paying for itself (see this file's own
 * docs/adr/0011-master-data-pattern.md).
 */
export function defineMasterModule<
  T extends MasterTable,
  TCreate extends Record<string, unknown> & { code: string; name: string },
  TUpdate extends Record<string, unknown>,
>(config: DefineMasterModuleConfig<T, TCreate, TUpdate>): MasterModule {
  const repository = createMasterRepository(config.table);
  const service = createMasterService({
    entity: config.entity,
    repository,
    ...(config.buildParentFilter ? { buildParentFilter: config.buildParentFilter } : {}),
    ...(config.extractParentValue ? { extractParentValue: config.extractParentValue } : {}),
  });
  const controller = createMasterController(service, {
    createSchema: config.createSchema,
    updateSchema: config.updateSchema,
  });
  const router = createMasterRouter(config.entity, controller);

  const permissions = [
    permissionEntry("masters", config.entity, "create", `Create a ${config.entity} master record`),
    permissionEntry("masters", config.entity, "read", `View ${config.entity} master records`),
    permissionEntry("masters", config.entity, "update", `Edit a ${config.entity} master record`),
  ];

  return {
    entity: config.entity,
    urlSegment: config.urlSegment,
    router,
    listOptions: controller.listOptions,
    permissions,
    fieldDefaults: buildFieldDefaults(config.entity, config.extraFieldDefaults ?? []),
  };
}
