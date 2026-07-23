import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { seedDefaultNumberSeries } from "../../../core/provisioning/seed-number-series.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, countries, currencies, paymentTerms, permissions, supplierTypes, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const supplierRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.enum(["active", "inactive"]),
  supplierTypeId: z.string(),
  countryId: z.string(),
  paymentTermId: z.string(),
  currencyId: z.string(),
  remarks: z.string().nullable().optional(),
  contacts: z.array(z.object({ id: z.string(), contactPerson: z.string() })).optional(),
  banks: z.array(z.object({ id: z.string(), details: z.string() })).optional(),
});

const paginatedResponseSchema = z.object({
  items: z.array(supplierRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const optionsResponseSchema = z.object({
  options: z.array(z.object({ value: z.string(), label: z.string(), code: z.string() })),
});

function asSupplier(res: { body: unknown }) {
  return supplierRowSchema.parse(res.body);
}
function asPaginated(res: { body: unknown }) {
  return paginatedResponseSchema.parse(res.body);
}
function asOptions(res: { body: unknown }) {
  return optionsResponseSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) => tx.select().from(permissions).where(eq(permissions.key, key)).limit(1));
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededSupplierTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
  masters: { supplierTypeId: string; countryId: string; paymentTermId: string; currencyId: string };
}

const ALL_SUPPLIER_PERMISSIONS = ["suppliers.supplier.create", "suppliers.supplier.read", "suppliers.supplier.update"];

async function seedSupplierTenant(label: string): Promise<SeededSupplierTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, masters } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }

    const [supplierType] = await tx
      .insert(supplierTypes)
      .values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id })
      .returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx
      .insert(paymentTerms)
      .values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id })
      .returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!supplierType || !country || !paymentTerm || !currency) {
      throw new Error("failed to insert prerequisite master data");
    }

    return {
      companyId: company.id,
      userId: user.id,
      masters: {
        supplierTypeId: supplierType.id,
        countryId: country.id,
        paymentTermId: paymentTerm.id,
        currencyId: currency.id,
      },
    };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_SUPPLIER_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, masters };
}

function basePayload(masters: SeededSupplierTenant["masters"], name: string) {
  return {
    name,
    supplierTypeId: masters.supplierTypeId,
    countryId: masters.countryId,
    paymentTermId: masters.paymentTermId,
    currencyId: masters.currencyId,
  };
}

describe("modules/suppliers - Supplier Master (docs/spec/Purchase-V2.md Sub Tab 1)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "FR-001/FR-002: creates a supplier with a unique, auto-generated, read-only Supplier Code",
    async () => {
      const tenant = await seedSupplierTenant("fr001");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app)
        .post("/api/v1/suppliers")
        .set("Authorization", authHeader)
        .send({
          ...basePayload(tenant.masters, "Acme Trading"),
          contacts: [{ contactPerson: "John Doe", mobile: "+971501234567", email: "john@example.com" }],
          banks: [{ details: "Bank of Test, Account 123456" }],
        });

      expect(res.status).toBe(201);
      const created = asSupplier(res);
      expect(created.name).toBe("Acme Trading");
      expect(created.code).toMatch(/^SUP-\d{4}$/);
      expect(created.status).toBe("active");
      expect(created.contacts).toHaveLength(1);
      expect(created.banks).toHaveLength(1);

      // A second supplier gets the next sequential code - proves FR-002 is a real counter, not a random id.
      const second = asSupplier(
        await request(app).post("/api/v1/suppliers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Second Supplier")),
      );
      expect(second.code).not.toBe(created.code);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-003: user can edit supplier information",
    async () => {
      const tenant = await seedSupplierTenant("fr003");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asSupplier(
        await request(app).post("/api/v1/suppliers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Editable Supplier")),
      );

      const updateRes = await request(app)
        .patch(`/api/v1/suppliers/${created.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Editable Supplier LLC", remarks: "Updated via FR-003 test", contacts: [{ contactPerson: "Jane Roe" }] });

      expect(updateRes.status).toBe(200);
      const updated = asSupplier(updateRes);
      expect(updated.name).toBe("Editable Supplier LLC");
      expect(updated.remarks).toBe("Updated via FR-003 test");
      expect(updated.contacts).toHaveLength(1);
      expect(updated.contacts?.[0]?.contactPerson).toBe("Jane Roe");
      // The code is read-only (spec Remarks) - never changed by an edit.
      expect(updated.code).toBe(created.code);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-004: user can activate/deactivate a supplier, and the record itself stays resolvable",
    async () => {
      const tenant = await seedSupplierTenant("fr004");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asSupplier(
        await request(app).post("/api/v1/suppliers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Togglable Supplier")),
      );
      expect(created.status).toBe("active");

      const deactivateRes = await request(app).patch(`/api/v1/suppliers/${created.id}/deactivate`).set("Authorization", authHeader);
      expect(deactivateRes.status).toBe(200);
      expect(asSupplier(deactivateRes).status).toBe("inactive");

      const getRes = await request(app).get(`/api/v1/suppliers/${created.id}`).set("Authorization", authHeader);
      expect(getRes.status).toBe(200);
      expect(asSupplier(getRes).id).toBe(created.id);

      const activateRes = await request(app).patch(`/api/v1/suppliers/${created.id}/activate`).set("Authorization", authHeader);
      expect(activateRes.status).toBe(200);
      expect(asSupplier(activateRes).status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-005: duplicate supplier names are rejected, but a soft-deleted supplier's name can be reused",
    async () => {
      const tenant = await seedSupplierTenant("fr005");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asSupplier(
        await request(app).post("/api/v1/suppliers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Unique Supplier Co")),
      );

      const duplicateRes = await request(app)
        .post("/api/v1/suppliers")
        .set("Authorization", authHeader)
        .send(basePayload(tenant.masters, "Unique Supplier Co"));
      expect(duplicateRes.status).toBe(409);

      // Renaming to a name in use by another supplier is rejected the same way.
      const other = asSupplier(
        await request(app).post("/api/v1/suppliers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Other Supplier Co")),
      );
      const renameCollisionRes = await request(app)
        .patch(`/api/v1/suppliers/${other.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Unique Supplier Co" });
      expect(renameCollisionRes.status).toBe(409);

      // Soft-deleting the original frees its name back up.
      const deleteRes = await request(app).delete(`/api/v1/suppliers/${created.id}`).set("Authorization", authHeader);
      expect(deleteRes.status).toBe(204);

      const reuseRes = await request(app)
        .post("/api/v1/suppliers")
        .set("Authorization", authHeader)
        .send(basePayload(tenant.masters, "Unique Supplier Co"));
      expect(reuseRes.status).toBe(201);
      expect(asSupplier(reuseRes).name).toBe("Unique Supplier Co");
      expect(asSupplier(reuseRes).id).not.toBe(created.id);

      // The soft-deleted supplier is gone from the admin list...
      const listRes = asPaginated(await request(app).get("/api/v1/suppliers").set("Authorization", authHeader));
      expect(listRes.items.some((row) => row.id === created.id)).toBe(false);

      // ...and gone by direct id lookup too (unlike a merely deactivated one).
      const getDeletedRes = await request(app).get(`/api/v1/suppliers/${created.id}`).set("Authorization", authHeader);
      expect(getDeletedRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "FR-006: a created supplier is immediately available in the options dropdown Purchase transactions use, and drops out once deactivated",
    async () => {
      const tenant = await seedSupplierTenant("fr006");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asSupplier(
        await request(app).post("/api/v1/suppliers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Purchasable Supplier")),
      );

      const before = asOptions(await request(app).get("/api/v1/suppliers/options").set("Authorization", authHeader));
      expect(before.options.some((o) => o.value === created.id && o.code === created.code)).toBe(true);

      await request(app).patch(`/api/v1/suppliers/${created.id}/deactivate`).set("Authorization", authHeader);

      const after = asOptions(await request(app).get("/api/v1/suppliers/options").set("Authorization", authHeader));
      expect(after.options.some((o) => o.value === created.id)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list is paginated server-side",
    async () => {
      const tenant = await seedSupplierTenant("pagination");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/api/v1/suppliers")
          .set("Authorization", authHeader)
          .send(basePayload(tenant.masters, `Paginated Supplier ${i}`));
      }

      const page1 = asPaginated(await request(app).get("/api/v1/suppliers").query({ page: 1, pageSize: 2 }).set("Authorization", authHeader));
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const allNames = new Set<string>();
      for (let page = 1; page <= 3; page += 1) {
        const res = asPaginated(await request(app).get("/api/v1/suppliers").query({ page, pageSize: 2 }).set("Authorization", authHeader));
        for (const row of res.items) {
          allNames.add(row.name);
        }
      }
      expect(allNames.size).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "supplier code is gapless and unique under concurrency",
    async () => {
      const tenant = await seedSupplierTenant("concurrency");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const CONCURRENCY = 20;

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          request(app)
            .post("/api/v1/suppliers")
            .set("Authorization", authHeader)
            .send(basePayload(tenant.masters, `Concurrent Supplier ${i}`)),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(201);
      }

      const codes = results.map((res) => asSupplier(res).code);
      expect(new Set(codes).size).toBe(CONCURRENCY);

      const sequenceNumbers = codes
        .map((code) => {
          const match = /^SUP-(\d{4})$/.exec(code);
          if (!match?.[1]) {
            throw new Error(`unexpected supplier code shape: ${code}`);
          }
          return Number(match[1]);
        })
        .sort((a, b) => a - b);
      expect(sequenceNumbers).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
    },
    TEST_TIMEOUT_MS,
  );
});
