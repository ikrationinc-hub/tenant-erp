import { createMenu } from "../menu-engine/mutations.js";

export interface SeedMenuTreeInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
}

interface DefaultMenuItem {
  key: string;
  label: string;
  path?: string;
  icon?: string;
  requiredPermission?: string;
  moduleKey?: string;
  children?: DefaultMenuItem[];
}

/**
 * A starting point every tenant gets, not a final navigation - a real
 * tenant's admin edits this via core/menu-engine/mutations.ts once masters
 * and purchase have real routes. `moduleKey` matches core/module-registry/
 * manifests.ts's keys exactly; `requiredPermission` matches core/rbac's
 * catalogue exactly - both are validated for real (not just by
 * convention) by core/menu-engine/resolve.ts at render time, so a typo
 * here just means the item silently never appears, not a crash.
 */
const DEFAULT_MENU_TREE: DefaultMenuItem[] = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: "dashboard" },
  {
    key: "users",
    label: "Users",
    icon: "users",
    moduleKey: "users",
    requiredPermission: "users.user.read",
    children: [
      { key: "users.list", label: "All Users", path: "/users", requiredPermission: "users.user.read" },
      {
        key: "users.invite",
        label: "Invite User",
        path: "/users/invite",
        requiredPermission: "users.user.create",
      },
    ],
  },
  {
    key: "roles",
    label: "Roles",
    path: "/roles",
    icon: "shield",
    moduleKey: "roles",
    requiredPermission: "admin.role.read",
  },
  {
    key: "masters",
    label: "Masters",
    icon: "database",
    moduleKey: "masters",
    children: [
      {
        key: "masters.suppliers",
        label: "Suppliers",
        path: "/masters/suppliers",
        requiredPermission: "masters.supplier.read",
      },
      {
        key: "masters.customers",
        label: "Customers",
        path: "/masters/customers",
        requiredPermission: "masters.customer.read",
      },
    ],
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
        requiredPermission: "purchase.po.read",
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
  });

  const children = node.children ?? [];
  for (const [i, child] of children.entries()) {
    // Sequential, not concurrent: children must be created after their parent exists (FK)
    await seedNode(input, child, menu.id, i);
  }
}

/** Not idempotent on its own, same reasoning as seed-roles.ts's seedDefaultRoles - see provision-tenant.ts. */
export async function seedDefaultMenuTree(input: SeedMenuTreeInput): Promise<void> {
  for (const [i, node] of DEFAULT_MENU_TREE.entries()) {
    // Sequential on purpose, see above
    await seedNode(input, node, undefined, i);
  }
}
