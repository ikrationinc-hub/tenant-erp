import type { ReactElement } from "react";
import type { FlatMenuEntry } from "../../core/navigation/menu-tree-utils";
import { MasterScreen } from "./MasterScreen";

export interface MasterRegistryEntry {
  /** field-definitions/permissions key (core/masters/registry.ts's `entity`, e.g. "country") - singular, NOT the REST path segment. */
  entity: string;
  /** REST path segment (core/masters/registry.ts's `urlSegment`, e.g. "countries") - the backend keeps this deliberately different from `entity`. */
  urlSegment: string;
  label: string;
}

/**
 * The 15 masters docs/spec/Purchase-V2.md §4 needs (FE-5), each a ~1-line
 * entry. This is NOT a route file (frontend rule 2) - which paths exist,
 * their labels, icons, and nesting all come from GET /menus; this only
 * supplies the one thing the menu tree doesn't carry: the mapping from a
 * master's REST urlSegment to its field-definitions entity key. Adding a
 * 16th master needs a line here (plus the backend module + a menu seed) -
 * zero new components.
 */
export const MASTER_REGISTRY: MasterRegistryEntry[] = [
  { entity: "country", urlSegment: "countries", label: "Countries" },
  { entity: "city", urlSegment: "cities", label: "Cities" },
  { entity: "currency", urlSegment: "currencies", label: "Currencies" },
  { entity: "payment_term", urlSegment: "payment-terms", label: "Payment Terms" },
  { entity: "uom", urlSegment: "uom", label: "Units of Measure" },
  { entity: "port", urlSegment: "ports", label: "Ports" },
  { entity: "warehouse", urlSegment: "warehouses", label: "Warehouses" },
  { entity: "incoterm", urlSegment: "incoterms", label: "Incoterms" },
  { entity: "item", urlSegment: "items", label: "Items" },
  { entity: "item_grade", urlSegment: "item-grades", label: "Item Grades" },
  { entity: "vessel", urlSegment: "vessels", label: "Vessels" },
  { entity: "transport_mode", urlSegment: "transport-modes", label: "Transport Modes" },
  { entity: "lme_exchange", urlSegment: "lme-exchanges", label: "LME Exchanges" },
  { entity: "hedge_platform", urlSegment: "hedge-platforms", label: "Hedge Platforms" },
  { entity: "supplier_type", urlSegment: "supplier-types", label: "Supplier Types" },
];

const MASTERS_PATH_PREFIX = "/masters/";

function findMasterByPath(path: string): MasterRegistryEntry | undefined {
  if (!path.startsWith(MASTERS_PATH_PREFIX)) {
    return undefined;
  }
  const urlSegment = path.slice(MASTERS_PATH_PREFIX.length);
  if (urlSegment.length === 0 || urlSegment.includes("/")) {
    return undefined;
  }
  return MASTER_REGISTRY.find((master) => master.urlSegment === urlSegment);
}

/** DynamicRoutes' resolveScreen hook - a menu path outside this registry (e.g. "/masters/suppliers", the dedicated Supplier module) falls through to the generic placeholder untouched. */
export function resolveMasterScreen(entry: FlatMenuEntry): ReactElement | null {
  const master = entry.path ? findMasterByPath(entry.path) : undefined;
  if (!master) {
    return null;
  }
  return <MasterScreen module="masters" entity={master.entity} urlSegment={master.urlSegment} label={entry.label} />;
}
