import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { requireModuleEnabled } from "../../common/middleware/require-module-enabled.js";
import { requirePermission } from "../../common/middleware/rbac.js";
import { scopeResolverMiddleware } from "../../common/middleware/scope-resolver.js";
import {
  cities,
  containers,
  countries,
  currencies,
  customers,
  divisions,
  hedgePlatforms,
  incoterms,
  itemGrades,
  items,
  lmeExchanges,
  paymentTerms,
  ports,
  supplierTypes,
  transportModes,
  uom,
  vessels,
  warehouses,
} from "../../database/tenant/schema.js";
import type { PermissionCatalogueEntry } from "../rbac/types.js";
import type { FieldDefault } from "../field-engine/types.js";
import { defineMasterModule, type MasterModule } from "./factory.js";
import { masterCreateBaseSchema } from "./validators.js";

/**
 * The 15 masters the Purchase spec's "Dropdown -> Master" fields need
 * (docs/spec/Purchase-V2.md §4), instantiated via one call each to
 * core/masters/factory.ts's defineMasterModule. Only `cities` (fk country)
 * and `items` (item_type, the vertical seam) need anything beyond the base
 * code/name/isActive/sortOrder columns every master gets from
 * database/tenant/schema.ts's defineMasterTable - 13 of 15 are a bare
 * `defineMasterModule({ entity, urlSegment, table, createSchema, updateSchema })`
 * call. If a 16th master needed more than this, that would be the signal
 * the pattern stopped paying for itself.
 */

const noExtraCreateSchema = masterCreateBaseSchema.strict();
const noExtraUpdateSchema = masterCreateBaseSchema.partial().strict();

export const countryModule = defineMasterModule({
  entity: "country",
  urlSegment: "countries",
  label: "Countries",
  table: countries,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

const cityCreateSchema = masterCreateBaseSchema.extend({ countryId: z.string().uuid() }).strict();
const cityUpdateSchema = masterCreateBaseSchema.partial().extend({ countryId: z.string().uuid().optional() }).strict();

export const cityModule = defineMasterModule({
  entity: "city",
  urlSegment: "cities",
  label: "Cities",
  table: cities,
  createSchema: cityCreateSchema,
  updateSchema: cityUpdateSchema,
  buildParentFilter: (parentValue) => [eq(cities.countryId, parentValue)],
  // row is MasterRow (repository.ts's generic row shape); countryId is a
  // real not-null uuid column on the cities table (schema.ts), just not
  // named in MasterRow's fixed fields.
  extractParentValue: (row) => row.countryId as string,
  extraFieldDefaults: [
    { fieldKey: "countryId", label: "Country", dataType: "select", isMandatory: true, optionsSource: "masters:countries" },
  ],
});

export const currencyModule = defineMasterModule({
  entity: "currency",
  urlSegment: "currencies",
  label: "Currencies",
  table: currencies,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const paymentTermModule = defineMasterModule({
  entity: "payment_term",
  urlSegment: "payment-terms",
  label: "Payment Terms",
  table: paymentTerms,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const uomModule = defineMasterModule({
  entity: "uom",
  urlSegment: "uom",
  label: "Units of Measure",
  table: uom,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const portModule = defineMasterModule({
  entity: "port",
  urlSegment: "ports",
  label: "Ports",
  table: ports,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const warehouseModule = defineMasterModule({
  entity: "warehouse",
  urlSegment: "warehouses",
  label: "Warehouses",
  table: warehouses,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const incotermModule = defineMasterModule({
  entity: "incoterm",
  urlSegment: "incoterms",
  label: "Incoterms",
  table: incoterms,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

const itemTypeSchema = z.enum(["metals", "electronics", "toys"]);
const itemCreateSchema = masterCreateBaseSchema.extend({ itemType: itemTypeSchema }).strict();
const itemUpdateSchema = masterCreateBaseSchema.partial().extend({ itemType: itemTypeSchema.optional() }).strict();

export const itemModule = defineMasterModule({
  entity: "item",
  urlSegment: "items",
  label: "Items",
  table: items,
  createSchema: itemCreateSchema,
  updateSchema: itemUpdateSchema,
  extraFieldDefaults: [
    {
      fieldKey: "itemType",
      label: "Item Type",
      dataType: "select",
      isMandatory: true,
      optionsSource: {
        type: "static",
        staticOptions: [
          { value: "metals", label: "Metals" },
          { value: "electronics", label: "Electronics" },
          { value: "toys", label: "Toys" },
        ],
      },
    },
  ],
});

export const itemGradeModule = defineMasterModule({
  entity: "item_grade",
  urlSegment: "item-grades",
  label: "Item Grades",
  table: itemGrades,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const vesselModule = defineMasterModule({
  entity: "vessel",
  urlSegment: "vessels",
  label: "Vessels",
  table: vessels,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const transportModeModule = defineMasterModule({
  entity: "transport_mode",
  urlSegment: "transport-modes",
  label: "Transport Modes",
  table: transportModes,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const lmeExchangeModule = defineMasterModule({
  entity: "lme_exchange",
  urlSegment: "lme-exchanges",
  label: "LME Exchanges",
  table: lmeExchanges,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const hedgePlatformModule = defineMasterModule({
  entity: "hedge_platform",
  urlSegment: "hedge-platforms",
  label: "Hedge Platforms",
  table: hedgePlatforms,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

export const supplierTypeModule = defineMasterModule({
  entity: "supplier_type",
  urlSegment: "supplier-types",
  label: "Supplier Types",
  table: supplierTypes,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

/**
 * Prompt 16's resolved decision: "customers" becomes a real (if minimal)
 * master now, not a placeholder until Sales - the customers table (and
 * purchase_allocations.reserved_customer_id's FK into it) already existed
 * from the Purchase build; only the registry instantiation was missing.
 * GET /masters/customers/options replaces apps/web's old bespoke
 * GET /customers/options - reservedCustomerId's optionsSource becomes
 * "masters:customers", same convention as every other Dropdown->Master
 * field.
 */
export const customerModule = defineMasterModule({
  entity: "customer",
  urlSegment: "customers",
  label: "Customers",
  table: customers,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

/** Prompt 21 item 1: the purchase-scoping master (Container/Electronics/Scrap/Bulk, seeded by seed-data.ts). No extra fields - just the vertical-model seam, not vertical-specific behavior yet. */
export const divisionModule = defineMasterModule({
  entity: "division",
  urlSegment: "divisions",
  label: "Divisions",
  table: divisions,
  createSchema: noExtraCreateSchema,
  updateSchema: noExtraUpdateSchema,
});

const containerCreateSchema = masterCreateBaseSchema.extend({ containerType: z.string().min(1).optional() }).strict();
const containerUpdateSchema = masterCreateBaseSchema.partial().extend({ containerType: z.string().min(1).optional() }).strict();

/** Prompt 21 item 5: was free text on purchase_shipments.container_number - promoted to a master, with create-on-the-fly from the shipment form's own combobox (core/schema-form/field-types' CreatableLookup), since container numbers are too numerous to expect pre-registration. `code` IS the container number (every master's own code/name split doesn't map cleanly onto a container, which has only one natural identifier - name mirrors code rather than inventing a second value nothing asks for). */
export const containerModule = defineMasterModule({
  entity: "container",
  urlSegment: "containers",
  label: "Containers",
  table: containers,
  createSchema: containerCreateSchema,
  updateSchema: containerUpdateSchema,
  extraFieldDefaults: [{ fieldKey: "containerType", label: "Type", dataType: "text" }],
});

export const MASTER_MODULES: MasterModule[] = [
  countryModule,
  cityModule,
  currencyModule,
  paymentTermModule,
  uomModule,
  portModule,
  warehouseModule,
  incotermModule,
  itemModule,
  itemGradeModule,
  vesselModule,
  transportModeModule,
  lmeExchangeModule,
  hedgePlatformModule,
  supplierTypeModule,
  customerModule,
  divisionModule,
  containerModule,
];

export const mastersRouter: Router = Router();

const requireMastersModule = requireModuleEnabled("masters");

/**
 * GET /api/v1/masters/:master/options, one static route per master rather
 * than a single `:master` param handler - matches the frontend's
 * already-built contract (packages/contracts/src/master-options.ts, apps/
 * web's endpoints.ts `masterOptions(master)`) URL-for-URL (a literal
 * `/masters/countries/options` route matches that exact request the same
 * way a `/masters/:master/options` route would), while letting each
 * master's own `read` permission gate its route normally through
 * requirePermission instead of a hand-rolled runtime dispatch. Registered
 * before the CRUD sub-routers below so "options" is never swallowed by a
 * conflicting `/:id`-shaped route on some future master.
 */
for (const module of MASTER_MODULES) {
  mastersRouter.get(
    `/${module.urlSegment}/options`,
    scopeResolverMiddleware,
    requireMastersModule,
    requirePermission(`masters.${module.entity}.read`),
    module.listOptions,
  );
}

for (const module of MASTER_MODULES) {
  mastersRouter.use(`/${module.urlSegment}`, module.router);
}

export const ALL_MASTER_PERMISSIONS: PermissionCatalogueEntry[] = MASTER_MODULES.flatMap(
  (module) => module.permissions,
);

export const ALL_MASTER_FIELD_DEFAULTS: FieldDefault[] = MASTER_MODULES.flatMap((module) => module.fieldDefaults);
