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
import { companies, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const brokerRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  code: z.string(),
  name: z.string(),
  status: z.enum(["active", "inactive"]),
  remarks: z.string().nullable().optional(),
  contacts: z.array(z.object({ id: z.string(), contactPerson: z.string() })).optional(),
  banks: z.array(z.object({ id: z.string(), details: z.string() })).optional(),
});

const paginatedResponseSchema = z.object({
  items: z.array(brokerRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const optionsResponseSchema = z.object({
  options: z.array(z.object({ value: z.string(), label: z.string(), code: z.string() })),
});

function asBroker(res: { body: unknown }) {
  return brokerRowSchema.parse(res.body);
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

interface SeededBrokerTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
}

const ALL_BROKER_PERMISSIONS = ["brokers.broker.create", "brokers.broker.read", "brokers.broker.update"];

async function seedBrokerTenant(label: string): Promise<SeededBrokerTenant> {
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
    return { companyId: company.id, userId: user.id };
  });

  await seedDefaultNumberSeries({ schemaName: tenant.schemaName, companyId, createdBy: userId });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_BROKER_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token };
}

describe("modules/brokers - Broker Master (Prompt 21 item 4, mirrors suppliers' own shape)", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "creates a broker with a unique, auto-generated, read-only code, plus contacts and banks",
    async () => {
      const tenant = await seedBrokerTenant("create");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app)
        .post("/api/v1/brokers")
        .set("Authorization", authHeader)
        .send({
          name: "Gulf Broking LLC",
          contacts: [{ contactPerson: "Sam Broker", mobile: "+971501234567", email: "sam@example.com" }],
          banks: [{ details: "Bank of Test, Account 654321" }],
        });

      expect(res.status).toBe(201);
      const created = asBroker(res);
      expect(created.name).toBe("Gulf Broking LLC");
      expect(created.code).toMatch(/^BRK-\d{4}$/);
      expect(created.status).toBe("active");
      expect(created.contacts).toHaveLength(1);
      expect(created.banks).toHaveLength(1);

      const second = asBroker(
        await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Second Broker" }),
      );
      expect(second.code).not.toBe(created.code);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "user can edit broker information; the code stays read-only",
    async () => {
      const tenant = await seedBrokerTenant("edit");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asBroker(
        await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Editable Broker" }),
      );

      const updateRes = await request(app)
        .patch(`/api/v1/brokers/${created.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Editable Broker LLC", remarks: "Updated via test", contacts: [{ contactPerson: "New Contact" }] });

      expect(updateRes.status).toBe(200);
      const updated = asBroker(updateRes);
      expect(updated.name).toBe("Editable Broker LLC");
      expect(updated.remarks).toBe("Updated via test");
      expect(updated.contacts).toHaveLength(1);
      expect(updated.code).toBe(created.code);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "user can activate/deactivate a broker, and the record itself stays resolvable",
    async () => {
      const tenant = await seedBrokerTenant("toggle");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asBroker(
        await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Togglable Broker" }),
      );
      expect(created.status).toBe("active");

      const deactivateRes = await request(app).patch(`/api/v1/brokers/${created.id}/deactivate`).set("Authorization", authHeader);
      expect(deactivateRes.status).toBe(200);
      expect(asBroker(deactivateRes).status).toBe("inactive");

      const getRes = await request(app).get(`/api/v1/brokers/${created.id}`).set("Authorization", authHeader);
      expect(getRes.status).toBe(200);

      const activateRes = await request(app).patch(`/api/v1/brokers/${created.id}/activate`).set("Authorization", authHeader);
      expect(activateRes.status).toBe(200);
      expect(asBroker(activateRes).status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "duplicate broker names are rejected, but a soft-deleted broker's name can be reused",
    async () => {
      const tenant = await seedBrokerTenant("dup");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asBroker(
        await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Unique Broker Co" }),
      );

      const duplicateRes = await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Unique Broker Co" });
      expect(duplicateRes.status).toBe(409);

      const deleteRes = await request(app).delete(`/api/v1/brokers/${created.id}`).set("Authorization", authHeader);
      expect(deleteRes.status).toBe(204);

      const reuseRes = await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Unique Broker Co" });
      expect(reuseRes.status).toBe(201);
      expect(asBroker(reuseRes).id).not.toBe(created.id);

      const getDeletedRes = await request(app).get(`/api/v1/brokers/${created.id}`).set("Authorization", authHeader);
      expect(getDeletedRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a created broker is immediately available in the options dropdown, and drops out once deactivated",
    async () => {
      const tenant = await seedBrokerTenant("options");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asBroker(
        await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: "Listed Broker" }),
      );

      const before = asOptions(await request(app).get("/api/v1/brokers/options").set("Authorization", authHeader));
      expect(before.options.some((o) => o.value === created.id && o.code === created.code)).toBe(true);

      await request(app).patch(`/api/v1/brokers/${created.id}/deactivate`).set("Authorization", authHeader);

      const after = asOptions(await request(app).get("/api/v1/brokers/options").set("Authorization", authHeader));
      expect(after.options.some((o) => o.value === created.id)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list is paginated server-side",
    async () => {
      const tenant = await seedBrokerTenant("pagination");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      for (let i = 0; i < 3; i += 1) {
        await request(app).post("/api/v1/brokers").set("Authorization", authHeader).send({ name: `Paginated Broker ${i}` });
      }

      const page1 = asPaginated(await request(app).get("/api/v1/brokers").query({ page: 1, pageSize: 2 }).set("Authorization", authHeader));
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );
});
