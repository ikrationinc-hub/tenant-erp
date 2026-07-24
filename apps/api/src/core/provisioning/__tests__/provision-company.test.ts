import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeDbPool } from "../../../config/db.js";
import { hashPassword } from "../../../core/auth/password.js";
import { resetMailer, setMailer } from "../../../core/notification/mailer.js";
import { insertPlatformAdmin } from "../../../modules/platform/platform.repository.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { menus, roles } from "../../../database/tenant/schema.js";
import { provisionCompany } from "../provision-company.js";
import { provisionTenant } from "../provision-tenant.js";
import { DEFAULT_ROLE_NAMES } from "../seed-roles.js";
import { closeRedis } from "../../../config/redis.js";

const TEST_TIMEOUT_MS = 120_000;

function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

describe("core/provisioning: provisionCompany", () => {
  afterEach(() => {
    resetMailer();
  });

  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "adds a second legal entity to an already-provisioned tenant, with its own seeded roles and menu",
    async () => {
      setMailer({ send: () => Promise.resolve() });
      const passwordHash = await hashPassword("platform-admin-password-1");
      const platformAdmin = await insertPlatformAdmin({
        email: `platform-admin-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash,
        name: "Platform Admin",
      });

      const slug = uniqueSlug("second-company");
      const tenantResult = await provisionTenant(
        { name: "Multi Co Group", slug, adminEmail: `admin-${slug}@example.com`, adminName: "Multi Admin", modules: [] },
        platformAdmin.id,
      );

      const companyResult = await provisionCompany({
        tenantSlug: slug,
        name: "Second Legal Entity",
        fiscalYearStartMonth: 4,
        timezone: "Europe/London",
        adminUserId: tenantResult.adminUserId,
      });

      expect(companyResult.companyId).not.toBe(tenantResult.companyId);
      expect(companyResult.branchId).toBeTruthy();

      const secondCompanyRoles = await withTenantSchema(tenantResult.schemaName, (tx) =>
        tx.select({ name: roles.name }).from(roles).where(eq(roles.companyId, companyResult.companyId)),
      );
      expect(new Set(secondCompanyRoles.map((r) => r.name))).toEqual(new Set(DEFAULT_ROLE_NAMES));

      const secondCompanyMenus = await withTenantSchema(tenantResult.schemaName, (tx) =>
        tx.select({ key: menus.key }).from(menus).where(eq(menus.companyId, companyResult.companyId)),
      );
      expect(secondCompanyMenus.length).toBeGreaterThan(0);

      // The first company's roles are untouched - a second company's setup must not disturb the first.
      const firstCompanyRoles = await withTenantSchema(tenantResult.schemaName, (tx) =>
        tx.select({ name: roles.name }).from(roles).where(eq(roles.companyId, tenantResult.companyId)),
      );
      expect(firstCompanyRoles).toHaveLength(DEFAULT_ROLE_NAMES.length);
    },
    TEST_TIMEOUT_MS,
  );
});
