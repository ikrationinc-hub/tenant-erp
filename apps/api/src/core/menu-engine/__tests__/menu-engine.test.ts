import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { RequestContext } from "../../../common/context/request-context.js";
import { closeDbPool } from "../../../config/db.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { closeRedis } from "../../../config/redis.js";
import { companies, permissions, users } from "../../../database/tenant/schema.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../rbac/mutations.js";
import { setModuleEnabled } from "../../module-registry/tenant-modules.js";
import { createMenu, setMenuVisibility } from "../mutations.js";
import { resolveMenuTree } from "../resolve.js";

const TEST_TIMEOUT_MS = 120_000;

interface SeededUser {
  tenant: ProvisionedTenant;
  companyId: string;
  userId: string;
}

async function seedTenantWithUser(label: string): Promise<SeededUser> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        name: `${label} Co`,
        countryCode: "US",
        currencyCode: "USD",
        fiscalYearStartMonth: 1,
        timezone: "America/New_York",
        createdBy: randomUUID(),
      })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    const [user] = await tx
      .insert(users)
      .values({
        companyId: company.id,
        email: `${label}-${unique}@example.com`,
        mobile: `+1${unique}`,
        name: `${label} User`,
        status: "active",
        createdBy: randomUUID(),
      })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  return { tenant, companyId, userId };
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) =>
    tx.select().from(permissions).where(eq(permissions.key, key)).limit(1),
  );
  if (!row) {
    throw new Error(`expected "${key}" to already be seeded by the provisioner`);
  }
  return row.id;
}

function ctxFor(seed: SeededUser): RequestContext {
  return {
    requestId: randomUUID(),
    tenantScope: {
      tenantId: seed.tenant.id,
      tenantSchema: seed.tenant.schemaName,
      companyId: seed.companyId,
      userId: seed.userId,
    },
  };
}

function flatten(tree: Awaited<ReturnType<typeof resolveMenuTree>>): string[] {
  const keys: string[] = [];
  for (const node of tree) {
    keys.push(node.key);
    keys.push(...flatten(node.children));
  }
  return keys;
}

describe("core/menu-engine: resolveMenuTree", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "hides a menu item whose required_permission the user lacks",
    async () => {
      const seed = await seedTenantWithUser("menu-permission");
      const ctx = ctxFor(seed);

      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "open-item",
        label: "Open Item",
        path: "/open",
        createdBy: seed.userId,
      });
      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "gated-item",
        label: "Gated Item",
        path: "/gated",
        requiredPermission: "purchase.po.approve",
        createdBy: seed.userId,
      });

      const tree = await resolveMenuTree(ctx);
      const keys = flatten(tree);
      expect(keys).toContain("open-item");
      expect(keys).not.toContain("gated-item");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hides a menu item belonging to a disabled module",
    async () => {
      const seed = await seedTenantWithUser("menu-module");
      const ctx = ctxFor(seed);

      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "purchase-item",
        label: "Purchase",
        path: "/purchase",
        moduleKey: "purchase",
        createdBy: seed.userId,
      });

      const enabledTree = await resolveMenuTree(ctx);
      expect(flatten(enabledTree)).toContain("purchase-item");

      await setModuleEnabled(seed.tenant.id, seed.tenant.schemaName, "purchase", false);

      const disabledTree = await resolveMenuTree(ctx);
      expect(flatten(disabledTree)).not.toContain("purchase-item");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "hides an entire subtree when the parent itself is gated out",
    async () => {
      const seed = await seedTenantWithUser("menu-subtree");
      const ctx = ctxFor(seed);

      const parent = await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "parent",
        label: "Parent",
        requiredPermission: "purchase.po.approve",
        createdBy: seed.userId,
      });
      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "child",
        label: "Child",
        path: "/child",
        parentId: parent.id,
        createdBy: seed.userId,
      });

      const tree = await resolveMenuTree(ctx);
      expect(flatten(tree)).not.toContain("child");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cache invalidates immediately on a role change - a newly granted permission's item appears without waiting for TTL",
    async () => {
      const seed = await seedTenantWithUser("menu-cache-role");
      const ctx = ctxFor(seed);

      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "approve-po",
        label: "Approve PO",
        path: "/po/approve",
        requiredPermission: "purchase.po.approve",
        createdBy: seed.userId,
      });

      const before = await resolveMenuTree(ctx);
      expect(flatten(before)).not.toContain("approve-po");

      const role = await createRole({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        name: "Approver",
        createdBy: seed.userId,
      });
      await assignRoleToUser(seed.tenant.schemaName, seed.companyId, seed.userId, role.id, seed.userId);
      const permissionId = await findPermissionId(seed.tenant.schemaName, "purchase.po.approve");
      await grantPermissionToRole(seed.tenant.schemaName, seed.companyId, role.id, permissionId, seed.userId);

      const after = await resolveMenuTree(ctx);
      expect(flatten(after)).toContain("approve-po");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cache invalidates on a menu change",
    async () => {
      const seed = await seedTenantWithUser("menu-cache-menu");
      const ctx = ctxFor(seed);

      const before = await resolveMenuTree(ctx);
      expect(flatten(before)).not.toContain("late-item");

      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "late-item",
        label: "Late Item",
        path: "/late",
        createdBy: seed.userId,
      });

      const after = await resolveMenuTree(ctx);
      expect(flatten(after)).toContain("late-item");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cache invalidates on a module being disabled",
    async () => {
      const seed = await seedTenantWithUser("menu-cache-module");
      const ctx = ctxFor(seed);

      await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "masters-item",
        label: "Masters",
        path: "/masters",
        moduleKey: "masters",
        createdBy: seed.userId,
      });

      const before = await resolveMenuTree(ctx);
      expect(flatten(before)).toContain("masters-item");

      await setModuleEnabled(seed.tenant.id, seed.tenant.schemaName, "masters", false);

      const after = await resolveMenuTree(ctx);
      expect(flatten(after)).not.toContain("masters-item");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an explicitly hidden (is_visible=false) item is never returned, permission and module aside",
    async () => {
      const seed = await seedTenantWithUser("menu-visibility");
      const ctx = ctxFor(seed);

      const menu = await createMenu({
        schemaName: seed.tenant.schemaName,
        companyId: seed.companyId,
        key: "hideable",
        label: "Hideable",
        path: "/hideable",
        createdBy: seed.userId,
      });

      expect(flatten(await resolveMenuTree(ctx))).toContain("hideable");

      await setMenuVisibility(seed.tenant.schemaName, seed.companyId, menu.id, false, seed.userId);

      expect(flatten(await resolveMenuTree(ctx))).not.toContain("hideable");
    },
    TEST_TIMEOUT_MS,
  );
});
