import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDbPool } from "../../src/config/db.js";
import { closeRedis } from "../../src/config/redis.js";
import { closeTenantDbPool, withTenantSchema } from "../../src/database/get-db.js";
import { branches, companies, purchases, suppliers, users } from "../../src/database/tenant/schema.js";
import { seedDefaultNumberSeries } from "../../src/core/provisioning/seed-number-series.js";
import { createTenantSchema } from "../../src/core/tenant/provisioner.js";
import { seedDevData } from "../seed-dev-core.js";

const TEST_TIMEOUT_MS = 120_000;

async function seedProvisionedTenant(label: string) {
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
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    await tx.insert(branches).values({ companyId: company.id, name: "Head Office", code: "HO", createdBy: user.id });
    return { companyId: company.id, userId: user.id };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  return tenant;
}

describe("scripts/seed-dev - the pnpm seed:dev dev-seed data", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "creates 3 suppliers and one purchase in each of draft/approved/posted, and is idempotent - a second run creates nothing new",
    async () => {
      const tenant = await seedProvisionedTenant("seed-dev");

      const first = await seedDevData(tenant.slug);
      expect(first.supplierIds).toHaveLength(3);
      expect(new Set(first.supplierIds).size).toBe(3);

      const supplierRows = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(suppliers));
      expect(supplierRows).toHaveLength(3);

      const purchaseRows = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchases));
      expect(purchaseRows).toHaveLength(3);
      expect(new Set(purchaseRows.map((row) => row.status))).toEqual(new Set(["draft", "approved", "posted"]));

      const postedRow = purchaseRows.find((row) => row.id === first.postedPurchaseId);
      expect(postedRow?.status).toBe("posted");

      // --- second run: same ids, no new rows -----------------------------
      const second = await seedDevData(tenant.slug);
      expect(second.supplierIds).toEqual(first.supplierIds);
      expect(second.draftPurchaseId).toBe(first.draftPurchaseId);
      expect(second.approvedPurchaseId).toBe(first.approvedPurchaseId);
      expect(second.postedPurchaseId).toBe(first.postedPurchaseId);

      const supplierRowsAfter = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(suppliers));
      expect(supplierRowsAfter).toHaveLength(3);

      const purchaseRowsAfter = await withTenantSchema(tenant.schemaName, (tx) => tx.select().from(purchases));
      expect(purchaseRowsAfter).toHaveLength(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses to run against a tenant with no provisioned company",
    async () => {
      const unique = randomUUID().slice(0, 8);
      const tenant = await createTenantSchema({ name: "No Company Co", slug: `no-company-${unique}` });

      await expect(seedDevData(tenant.slug)).rejects.toThrow(/has no company/);
    },
    TEST_TIMEOUT_MS,
  );
});
