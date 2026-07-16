import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { tenantModules, tenants } from "../../src/database/platform/schema.js";
import { useTestDatabase } from "../helpers/test-database.js";

describe("platform schema", () => {
  const ctx = useTestDatabase();

  it("applies migrations cleanly to an empty database", async () => {
    const rows = await ctx.db.select().from(tenants);
    expect(rows).toEqual([]);
  });

  it("accepts a tenant row with default status and enforces the slug/schema_name uniques", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({
        name: "Acme Metals",
        slug: "acme-metals",
        schemaName: "tenant_acme_metals",
      })
      .returning();

    expect(tenant).toMatchObject({
      name: "Acme Metals",
      slug: "acme-metals",
      schemaName: "tenant_acme_metals",
      status: "provisioning",
    });

    await expect(
      ctx.db.insert(tenants).values({
        name: "Acme Metals Duplicate",
        slug: "acme-metals",
        schemaName: "tenant_acme_metals_2",
      }),
    ).rejects.toThrow();
  });

  it("enforces the (tenant_id, module_key) unique constraint on tenant_modules", async () => {
    const [tenant] = await ctx.db
      .insert(tenants)
      .values({
        name: "Beta Trading",
        slug: "beta-trading",
        schemaName: "tenant_beta_trading",
      })
      .returning();

    if (!tenant) {
      throw new Error("expected tenant to be inserted");
    }

    await ctx.db.insert(tenantModules).values({
      tenantId: tenant.id,
      moduleKey: "purchase",
    });

    await expect(
      ctx.db.insert(tenantModules).values({
        tenantId: tenant.id,
        moduleKey: "purchase",
      }),
    ).rejects.toThrow();

    const modules = await ctx.db.select().from(tenantModules).where(eq(tenantModules.tenantId, tenant.id));
    expect(modules).toHaveLength(1);
  });
});
