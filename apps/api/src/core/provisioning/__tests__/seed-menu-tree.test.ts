import { randomUUID } from "node:crypto";
import { isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { getPermissionCatalogue } from "../../module-registry/registry.js";
import { createTenantSchema } from "../../tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, menus, users } from "../../../database/tenant/schema.js";
import { MASTER_MODULES } from "../../masters/registry.js";
import { seedDefaultMenuTree } from "../seed-menu-tree.js";

const TEST_TIMEOUT_MS = 120_000;

/**
 * The regression guard this task asked for: apps/api has no dependency on
 * apps/web, so this can't literally import apps/web's route registries -
 * this is a manually-synced mirror of the paths they currently resolve
 * (modules/admin/admin-registry.tsx's ADMIN_SCREENS, modules/masters/
 * master-registry.tsx's MASTER_REGISTRY, modules/suppliers/
 * supplier-registry.tsx, modules/purchase/purchase-registry.tsx).
 * "/dashboard" needs no entry: DynamicRoutes renders ANY exact menu-path
 * match that has no specific resolver as a generic PlaceholderScreen, not
 * a 404 - it's never "broken", just unstyled.
 *
 * KNOWN, DELIBERATE EXCEPTION: "/masters/customers" is seeded (customers
 * is a real master as of prompt 16) but apps/web's MASTER_REGISTRY doesn't
 * list "customer" yet - FE-8 is the tracked follow-up that adds it. This
 * is the ONLY path allowed to be seeded-but-not-yet-frontend-resolvable;
 * if this test starts failing on some OTHER path, that's real, new drift.
 */
const FRONTEND_RESOLVABLE_PATHS = new Set([
  "/dashboard",
  "/companies",
  "/branches",
  "/users",
  "/roles",
  "/admin/field-definitions",
  "/suppliers",
  "/purchase/orders",
  ...MASTER_MODULES.filter((module) => module.entity !== "customer").map((module) => `/masters/${module.urlSegment}`),
]);
const KNOWN_PENDING_FRONTEND_EXCEPTIONS = new Set(["/masters/customers"]);

interface FlatMenuRow {
  path: string | null;
  requiredPermission: string | null;
}

async function seedTenantWithMenus(label: string): Promise<{ schemaName: string; companyId: string }> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    if (!company) {
      throw new Error("failed to insert company");
    }
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} User`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  await seedDefaultMenuTree({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  return { schemaName: tenant.schemaName, companyId };
}

describe("core/provisioning/seed-menu-tree - the seeded default navigation", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "every seeded requiredPermission is a real key in the permission catalogue - never a stale/invalid one that silently drops the node for every user",
    async () => {
      const { schemaName } = await seedTenantWithMenus("menu-perms");
      const rows: FlatMenuRow[] = await withTenantSchema(schemaName, (tx) =>
        tx
          .select({ path: menus.path, requiredPermission: menus.requiredPermission })
          .from(menus)
          .where(isNull(menus.deletedAt)),
      );

      const catalogueKeys = new Set(getPermissionCatalogue().map((entry) => entry.key));
      const invalidPermissions = rows
        .filter((row) => row.requiredPermission !== null)
        .map((row) => row.requiredPermission as string)
        .filter((key) => !catalogueKeys.has(key));

      expect(invalidPermissions).toEqual([]);
      // Sanity: this suite would pass vacuously if requiredPermission were
      // never set at all - assert there really are several to check.
      expect(rows.filter((row) => row.requiredPermission !== null).length).toBeGreaterThan(10);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "every seeded leaf path resolves to a real apps/web screen, with only the one documented FE-8 exception (masters/customers)",
    async () => {
      const { schemaName } = await seedTenantWithMenus("menu-paths");
      const rows: FlatMenuRow[] = await withTenantSchema(schemaName, (tx) =>
        tx.select({ path: menus.path, requiredPermission: menus.requiredPermission }).from(menus).where(isNull(menus.deletedAt)),
      );

      const leafPaths = rows.map((row) => row.path).filter((path): path is string => path !== null);

      const unresolvable = leafPaths.filter(
        (path) => !FRONTEND_RESOLVABLE_PATHS.has(path) && !KNOWN_PENDING_FRONTEND_EXCEPTIONS.has(path),
      );
      expect(unresolvable).toEqual([]);

      // Every screen this task named must actually be there - no exceptions.
      for (const required of [
        "/companies",
        "/branches",
        "/users",
        "/roles",
        "/admin/field-definitions",
        "/suppliers",
        "/purchase/orders",
        ...MASTER_MODULES.map((module) => `/masters/${module.urlSegment}`),
      ]) {
        expect(leafPaths).toContain(required);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "suppliers moved out from under masters - no masters.supplier.* permission key exists, and /suppliers is a top-level node",
    async () => {
      const { schemaName } = await seedTenantWithMenus("menu-suppliers");
      const rows = await withTenantSchema(schemaName, (tx) =>
        tx.select({ key: menus.key, path: menus.path, requiredPermission: menus.requiredPermission }).from(menus).where(isNull(menus.deletedAt)),
      );

      const suppliersNode = rows.find((row) => row.key === "suppliers");
      expect(suppliersNode?.path).toBe("/suppliers");
      expect(suppliersNode?.requiredPermission).toBe("suppliers.supplier.read");
      expect(rows.some((row) => row.key === "masters.suppliers")).toBe(false);
      expect(rows.some((row) => row.requiredPermission?.startsWith("masters.supplier."))).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
