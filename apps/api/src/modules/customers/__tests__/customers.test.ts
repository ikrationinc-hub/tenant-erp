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
import { companies, countries, currencies, customerTypes, paymentTerms, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const customerRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.enum(["active", "inactive"]),
  customerTypeId: z.string(),
  countryId: z.string(),
  paymentTermId: z.string(),
  currencyId: z.string(),
  creditLimit: z.string(),
  remarks: z.string().nullable().optional(),
  contacts: z.array(z.object({ id: z.string(), contactPerson: z.string() })).optional(),
  banks: z.array(z.object({ id: z.string(), details: z.string() })).optional(),
});

const paginatedResponseSchema = z.object({
  items: z.array(customerRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const optionsResponseSchema = z.object({
  options: z.array(z.object({ value: z.string(), label: z.string(), code: z.string() })),
});

function asCustomer(res: { body: unknown }) {
  return customerRowSchema.parse(res.body);
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

interface SeededCustomerTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
  masters: { customerTypeId: string; countryId: string; paymentTermId: string; currencyId: string };
}

const ALL_CUSTOMER_PERMISSIONS = ["customers.customer.create", "customers.customer.read", "customers.customer.update"];

async function seedCustomerTenant(label: string): Promise<SeededCustomerTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, masters } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({
        name: `${label} Co`,
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

    const [customerType] = await tx
      .insert(customerTypes)
      .values({ companyId: company.id, code: "LOCAL", name: "Local", createdBy: user.id })
      .returning();
    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [paymentTerm] = await tx
      .insert(paymentTerms)
      .values({ companyId: company.id, code: "NET30", name: "30 Days", createdBy: user.id })
      .returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "USD", name: "US Dollar", createdBy: user.id }).returning();
    if (!customerType || !country || !paymentTerm || !currency) {
      throw new Error("failed to insert prerequisite master data");
    }

    return {
      companyId: company.id,
      userId: user.id,
      masters: {
        customerTypeId: customerType.id,
        countryId: country.id,
        paymentTermId: paymentTerm.id,
        currencyId: currency.id,
      },
    };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_CUSTOMER_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, masters };
}

function basePayload(refs: SeededCustomerTenant["masters"], name: string) {
  return {
    name,
    customerTypeId: refs.customerTypeId,
    countryId: refs.countryId,
    paymentTermId: refs.paymentTermId,
    currencyId: refs.currencyId,
  };
}

describe("modules/customers - Customer Master (S-1, docs/SALES-MODULE-PLAN.md)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "creates a customer with a unique, auto-generated, read-only Customer Code",
    async () => {
      const tenant = await seedCustomerTenant("cust001");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", authHeader)
        .send({
          ...basePayload(tenant.masters, "Northgate Metals"),
          creditLimit: "500000.00",
          contacts: [{ contactPerson: "Jane Doe", mobile: "+971501234567", email: "jane@example.com" }],
          banks: [{ details: "Bank of Test, Account 654321" }],
        });

      expect(res.status).toBe(201);
      const created = asCustomer(res);
      expect(created.name).toBe("Northgate Metals");
      expect(created.code).toMatch(/^CUS-\d{4}$/);
      expect(created.status).toBe("active");
      expect(created.creditLimit).toBe("500000.00");
      expect(created.contacts).toHaveLength(1);
      expect(created.banks).toHaveLength(1);

      const second = asCustomer(
        await request(app).post("/api/v1/customers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Second Customer")),
      );
      expect(second.code).not.toBe(created.code);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "user can edit customer information",
    async () => {
      const tenant = await seedCustomerTenant("cust003");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asCustomer(
        await request(app).post("/api/v1/customers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Editable Customer")),
      );

      const updateRes = await request(app)
        .patch(`/api/v1/customers/${created.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Editable Customer LLC", remarks: "Updated via test", contacts: [{ contactPerson: "Jane Roe" }] });

      expect(updateRes.status).toBe(200);
      const updated = asCustomer(updateRes);
      expect(updated.name).toBe("Editable Customer LLC");
      expect(updated.remarks).toBe("Updated via test");
      expect(updated.contacts).toHaveLength(1);
      expect(updated.contacts?.[0]?.contactPerson).toBe("Jane Roe");
      expect(updated.code).toBe(created.code);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "user can activate/deactivate a customer, and the record itself stays resolvable",
    async () => {
      const tenant = await seedCustomerTenant("cust004");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asCustomer(
        await request(app).post("/api/v1/customers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Togglable Customer")),
      );
      expect(created.status).toBe("active");

      const deactivateRes = await request(app).patch(`/api/v1/customers/${created.id}/deactivate`).set("Authorization", authHeader);
      expect(deactivateRes.status).toBe(200);
      expect(asCustomer(deactivateRes).status).toBe("inactive");

      const getRes = await request(app).get(`/api/v1/customers/${created.id}`).set("Authorization", authHeader);
      expect(getRes.status).toBe(200);
      expect(asCustomer(getRes).id).toBe(created.id);

      const activateRes = await request(app).patch(`/api/v1/customers/${created.id}/activate`).set("Authorization", authHeader);
      expect(activateRes.status).toBe(200);
      expect(asCustomer(activateRes).status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "duplicate customer names are rejected, but a soft-deleted customer's name can be reused",
    async () => {
      const tenant = await seedCustomerTenant("cust005");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asCustomer(
        await request(app).post("/api/v1/customers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Unique Customer Co")),
      );

      const duplicateRes = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", authHeader)
        .send(basePayload(tenant.masters, "Unique Customer Co"));
      expect(duplicateRes.status).toBe(409);

      const other = asCustomer(
        await request(app).post("/api/v1/customers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Other Customer Co")),
      );
      const renameCollisionRes = await request(app)
        .patch(`/api/v1/customers/${other.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Unique Customer Co" });
      expect(renameCollisionRes.status).toBe(409);

      const deleteRes = await request(app).delete(`/api/v1/customers/${created.id}`).set("Authorization", authHeader);
      expect(deleteRes.status).toBe(204);

      const reuseRes = await request(app)
        .post("/api/v1/customers")
        .set("Authorization", authHeader)
        .send(basePayload(tenant.masters, "Unique Customer Co"));
      expect(reuseRes.status).toBe(201);
      expect(asCustomer(reuseRes).name).toBe("Unique Customer Co");
      expect(asCustomer(reuseRes).id).not.toBe(created.id);

      const listRes = asPaginated(await request(app).get("/api/v1/customers").set("Authorization", authHeader));
      expect(listRes.items.some((row) => row.id === created.id)).toBe(false);

      const getDeletedRes = await request(app).get(`/api/v1/customers/${created.id}`).set("Authorization", authHeader);
      expect(getDeletedRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a created customer is immediately available in the options dropdown (both /customers/options and the re-pointed /masters/customers/options), and drops out once deactivated",
    async () => {
      const tenant = await seedCustomerTenant("cust006");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asCustomer(
        await request(app).post("/api/v1/customers").set("Authorization", authHeader).send(basePayload(tenant.masters, "Sellable Customer")),
      );

      const before = asOptions(await request(app).get("/api/v1/customers/options").set("Authorization", authHeader));
      expect(before.options.some((o) => o.value === created.id && o.code === created.code)).toBe(true);

      // The deliberate exception in core/masters/registry.ts - existing
      // callers (ContractPartiesForm.tsx etc.) hit this exact URL.
      const viaMasters = asOptions(await request(app).get("/api/v1/masters/customers/options").set("Authorization", authHeader));
      expect(viaMasters.options.some((o) => o.value === created.id)).toBe(true);

      await request(app).patch(`/api/v1/customers/${created.id}/deactivate`).set("Authorization", authHeader);

      const after = asOptions(await request(app).get("/api/v1/customers/options").set("Authorization", authHeader));
      expect(after.options.some((o) => o.value === created.id)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list is paginated server-side",
    async () => {
      const tenant = await seedCustomerTenant("pagination");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/api/v1/customers")
          .set("Authorization", authHeader)
          .send(basePayload(tenant.masters, `Paginated Customer ${i}`));
      }

      const page1 = asPaginated(await request(app).get("/api/v1/customers").query({ page: 1, pageSize: 2 }).set("Authorization", authHeader));
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const allNames = new Set<string>();
      for (let page = 1; page <= 3; page += 1) {
        const res = asPaginated(await request(app).get("/api/v1/customers").query({ page, pageSize: 2 }).set("Authorization", authHeader));
        for (const row of res.items) {
          allNames.add(row.name);
        }
      }
      expect(allNames.size).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "customer code is gapless and unique under concurrency",
    async () => {
      const tenant = await seedCustomerTenant("concurrency");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;
      const CONCURRENCY = 20;

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          request(app)
            .post("/api/v1/customers")
            .set("Authorization", authHeader)
            .send(basePayload(tenant.masters, `Concurrent Customer ${i}`)),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(201);
      }

      const codes = results.map((res) => asCustomer(res).code);
      expect(new Set(codes).size).toBe(CONCURRENCY);

      const sequenceNumbers = codes
        .map((code) => {
          const match = /^CUS-(\d{4})$/.exec(code);
          if (!match?.[1]) {
            throw new Error(`unexpected customer code shape: ${code}`);
          }
          return Number(match[1]);
        })
        .sort((a, b) => a - b);
      expect(sequenceNumbers).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1));
    },
    TEST_TIMEOUT_MS,
  );
});
