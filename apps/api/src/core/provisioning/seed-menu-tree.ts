import { MASTER_MODULES } from "../masters/registry.js";
import { createMenu } from "../menu-engine/mutations.js";

export interface SeedMenuTreeInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
}

type MenuSection = "operate" | "settings";

interface DefaultMenuItem {
  key: string;
  label: string;
  path?: string;
  icon?: string;
  requiredPermission?: string;
  moduleKey?: string;
  /** Which nav shell this renders in - main sidebar ("operate") or the Settings area ("settings"). Defaults to "operate" if omitted (see seedNode). A parent's section is independent of its children's - "masters" itself has no path and never renders as a clickable node, only its children matter. */
  section?: MenuSection;
  /** Settings launcher grouping only (apps/web's SettingsLauncher) - the top-level heading (launcherSection) and card (launcherGroup) this node's link appears under. Never set on an "operate" node; never affects routing, permissions, or the settings sub-nav tree, which both ignore these two fields entirely. */
  launcherSection?: string;
  launcherGroup?: string;
  children?: DefaultMenuItem[];
}

/**
 * Sub-groups masters within the launcher's "Masters" card into topical
 * clusters (Geography/Commercial/Trading/Logistics), independent of
 * MASTER_MODULES' own ordering - purely a launcher presentation concern,
 * not a change to the masters registry, the settings sub-nav tree (which
 * still shows one flat "Masters" submenu), or any master's route/entity.
 * A master's urlSegment not listed here falls back to "Logistics" so a
 * newly added master never disappears from the launcher, just lands in a
 * reasonable default bucket until this map is updated for it.
 */
const MASTER_LAUNCHER_GROUPS: Record<string, string> = {
  countries: "Geography",
  cities: "Geography",
  ports: "Geography",
  currencies: "Commercial",
  "payment-terms": "Commercial",
  incoterms: "Commercial",
  uom: "Commercial",
  "lme-exchanges": "Trading",
  "hedge-platforms": "Trading",
  divisions: "Trading",
  "supplier-types": "Trading",
  warehouses: "Logistics",
  vessels: "Logistics",
  "transport-modes": "Logistics",
  containers: "Logistics",
  items: "Logistics",
  "item-grades": "Logistics",
  customers: "Logistics",
};

/**
 * The masters children are GENERATED from core/masters/registry.ts's
 * MASTER_MODULES, one node per master - never 16 hand-written entries.
 * This is the exact discipline whose absence caused the bug this file was
 * rewritten to fix: DEFAULT_MENU_TREE below drifted from what apps/web
 * actually resolves (docs/CLAUDE-CODE-PROMPTS.md's "Fix the seeded menu
 * tree" task) because masters were hand-listed here (two of them, wrong)
 * instead of generated from the one place that actually knows the full
 * set. Mirrors apps/web/src/mocks/handlers.ts's mockMenuTree, which
 * generates the equivalent list from its own MASTER_REGISTRY the same
 * way - that file is the accurate target shape apps/web has actually
 * been built and tested against.
 */
function buildMastersChildren(): DefaultMenuItem[] {
  return MASTER_MODULES.map((module) => ({
    key: `masters.${module.urlSegment}`,
    label: module.label,
    path: `/settings/masters/${module.urlSegment}`,
    requiredPermission: `masters.${module.entity}.read`,
    section: "settings",
    launcherSection: "Master Data",
    launcherGroup: MASTER_LAUNCHER_GROUPS[module.urlSegment] ?? "Logistics",
  }));
}

/**
 * A starting point every tenant gets, not a final navigation - a real
 * tenant's admin edits this via core/menu-engine/mutations.ts.
 * `moduleKey` matches core/module-registry/manifests.ts's keys exactly;
 * `requiredPermission` matches core/rbac's catalogue exactly - both are
 * validated for real (not just by convention) by core/menu-engine/
 * resolve.ts at render time, so a typo here just means the item silently
 * never appears, not a crash. Suppliers is its own top-level module
 * (FE-6: contacts/banks sub-tables, activate/deactivate, its own
 * permission namespace "suppliers.supplier.*") - it does NOT live under
 * Masters, unlike the 16 generic masters (which do, including
 * "customers": a real master since prompt 16, not a placeholder).
 */
const DEFAULT_MENU_TREE: DefaultMenuItem[] = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard" },
  {
    key: "suppliers",
    label: "Suppliers",
    path: "/suppliers",
    icon: "shop",
    moduleKey: "suppliers",
    requiredPermission: "suppliers.supplier.read",
  },
  {
    key: "brokers",
    label: "Brokers",
    path: "/brokers",
    icon: "contacts",
    moduleKey: "brokers",
    requiredPermission: "brokers.broker.read",
  },
  {
    key: "purchase",
    label: "Purchase",
    icon: "shopping-cart",
    moduleKey: "purchase",
    requiredPermission: "purchase.po.read",
    children: [
      {
        key: "purchase.orders",
        label: "Purchase Orders",
        path: "/purchase/orders",
        icon: "file-text",
        requiredPermission: "purchase.po.read",
      },
      // PL-4: Zoho's own "Purchase Receives" and "Bills" nav items -
      // reusing purchase.po.read (no purchase.receipt.read/
      // purchase.invoice.read exist - the backend routes these list
      // screens call gate on purchase.po.read too, see purchase.routes.ts).
      {
        key: "purchase.receipts",
        label: "Purchase Receipts",
        path: "/purchase/receipts",
        icon: "file-done",
        requiredPermission: "purchase.po.read",
      },
      {
        key: "purchase.bills",
        label: "Purchase Bills",
        path: "/purchase/bills",
        icon: "account-book",
        requiredPermission: "purchase.po.read",
      },
      // PL-5: Zoho's own "Payments Made" nav item - reusing
      // purchase.po.read, same reasoning as Receipts/Bills above.
      {
        key: "purchase.payments",
        label: "Payments Made",
        path: "/purchase/payments",
        icon: "dollar",
        requiredPermission: "purchase.po.read",
      },
    ],
  },
  {
    key: "inventory",
    label: "Inventory",
    path: "/inventory",
    icon: "inbox",
    moduleKey: "inventory",
    requiredPermission: "inventory.stock.read",
  },
  // --- Settings (configure) - Zoho-style split: everything below here is
  // reached via the header gear, not the main sidebar. See
  // docs/PROMPT-settings-restructure.md.
  {
    key: "companies",
    label: "Companies",
    path: "/settings/companies",
    icon: "bank",
    moduleKey: "admin",
    requiredPermission: "admin.company.read",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Organization",
  },
  {
    key: "branches",
    label: "Branches",
    path: "/settings/branches",
    icon: "apartment",
    moduleKey: "admin",
    requiredPermission: "admin.branch.read",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Organization",
  },
  {
    key: "users",
    label: "Users",
    path: "/settings/users",
    icon: "users",
    moduleKey: "users",
    requiredPermission: "users.user.read",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Users & Roles",
  },
  {
    key: "roles",
    label: "Roles",
    path: "/settings/roles",
    icon: "shield",
    moduleKey: "roles",
    requiredPermission: "admin.role.read",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Users & Roles",
  },
  {
    key: "field-definitions",
    label: "Field Definitions",
    path: "/settings/field-definitions",
    icon: "form",
    moduleKey: "field-definitions",
    requiredPermission: "admin.field.manage",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Setup & Configuration",
  },
  {
    key: "number-series",
    label: "Number Series",
    path: "/settings/number-series",
    icon: "ordered-list",
    moduleKey: "admin",
    requiredPermission: "admin.company.read",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Setup & Configuration",
  },
  {
    key: "masters",
    label: "Masters",
    icon: "database",
    moduleKey: "masters",
    section: "settings",
    children: buildMastersChildren(),
  },
  // C-1 (docs/CONTRACT-MODULE-BUILD.md): the versioned clause library -
  // Settings-side for now (legal/setup content, same shelf as Field
  // Definitions/Masters), same as those every subsequent Contract-module
  // screen (templates, the contract document itself) will likely join this
  // node as its own child once C-3b/C-4 land.
  {
    key: "contract",
    label: "Contract",
    icon: "file-protect",
    moduleKey: "contract",
    section: "settings",
    launcherSection: "Organization Settings",
    launcherGroup: "Setup & Configuration",
    children: [
      {
        key: "contract.clauses",
        label: "Clause Library",
        path: "/settings/contract/clauses",
        icon: "file-protect",
        requiredPermission: "contract.clause.read",
      },
    ],
  },
];

async function seedNode(
  input: SeedMenuTreeInput,
  node: DefaultMenuItem,
  parentId: string | undefined,
  sortOrder: number,
): Promise<void> {
  const menu = await createMenu({
    schemaName: input.schemaName,
    companyId: input.companyId,
    key: node.key,
    label: node.label,
    sortOrder,
    createdBy: input.createdBy,
    ...(node.path !== undefined ? { path: node.path } : {}),
    ...(node.icon !== undefined ? { icon: node.icon } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(node.requiredPermission !== undefined ? { requiredPermission: node.requiredPermission } : {}),
    ...(node.moduleKey !== undefined ? { moduleKey: node.moduleKey } : {}),
    ...(node.launcherSection !== undefined ? { launcherSection: node.launcherSection } : {}),
    ...(node.launcherGroup !== undefined ? { launcherGroup: node.launcherGroup } : {}),
    section: node.section ?? "operate",
  });

  const children = node.children ?? [];
  for (const [i, child] of children.entries()) {
    // Sequential, not concurrent: children must be created after their parent exists (FK)
    await seedNode(input, child, menu.id, i);
  }
}

/** Safely re-runnable against an already-provisioned tenant: createMenu upserts by (companyId, key), so a node added to DEFAULT_MENU_TREE after a tenant was first provisioned gets inserted on the next call instead of erroring or duplicating - the backfill path for exactly that gap. */
export async function seedDefaultMenuTree(input: SeedMenuTreeInput): Promise<void> {
  for (const [i, node] of DEFAULT_MENU_TREE.entries()) {
    // Sequential on purpose, see above
    await seedNode(input, node, undefined, i);
  }
}
