import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { assignRoleToUser, createRole, grantPermissionToRole } from "../../../core/rbac/mutations.js";
import { createTenantSchema } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, countries, currencies, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const companyRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  countryId: z.string().nullable(),
  currencyId: z.string().nullable(),
  fiscalYearStartMonth: z.number(),
  timezone: z.string(),
  taxRegistrationNo: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
});

const paginatedResponseSchema = z.object({
  items: z.array(companyRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

function asCompany(res: { body: unknown }) {
  return companyRowSchema.parse(res.body);
}
function asPaginated(res: { body: unknown }) {
  return paginatedResponseSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) => tx.select().from(permissions).where(eq(permissions.key, key)).limit(1));
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededTenant {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
  masters: { countryId: string; currencyId: string };
}

const ALL_COMPANY_PERMISSIONS = ["admin.company.create", "admin.company.read", "admin.company.update"];

async function seedTenant(label: string, permissionKeys: string[] = ALL_COMPANY_PERMISSIONS): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId, masters } = await withTenantSchema(tenant.schemaName, async (tx) => {
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

    const [country] = await tx.insert(countries).values({ companyId: company.id, code: "AE", name: "UAE", createdBy: user.id }).returning();
    const [currency] = await tx.insert(currencies).values({ companyId: company.id, code: "AED", name: "UAE Dirham", createdBy: user.id }).returning();
    if (!country || !currency) {
      throw new Error("failed to insert prerequisite master data");
    }

    return { companyId: company.id, userId: user.id, masters: { countryId: country.id, currencyId: currency.id } };
  });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of permissionKeys) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token, masters };
}

describe("modules/companies - tenant-admin API surface", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "creates a company with country_id/currency_id FK columns and a tax registration number, paginated list included",
    async () => {
      const tenant = await seedTenant("create");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const res = await request(app)
        .post("/api/v1/companies")
        .set("Authorization", authHeader)
        .send({
          name: "Second Legal Entity",
          countryId: tenant.masters.countryId,
          currencyId: tenant.masters.currencyId,
          fiscalYearStartMonth: 4,
          timezone: "Asia/Dubai",
          taxRegistrationNo: "TRN-1000",
        });

      expect(res.status).toBe(201);
      const created = asCompany(res);
      expect(created.countryId).toBe(tenant.masters.countryId);
      expect(created.currencyId).toBe(tenant.masters.currencyId);
      expect(created.taxRegistrationNo).toBe("TRN-1000");
      expect(created.status).toBe("active");

      const listRes = asPaginated(await request(app).get("/api/v1/companies").set("Authorization", authHeader));
      expect(listRes.items.some((row) => row.id === created.id)).toBe(true);
      // The default company from seedTenant is in the same tenant schema too.
      expect(listRes.total).toBeGreaterThanOrEqual(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "edits a company through the normal PATCH - no separate activate/deactivate route (task item 1)",
    async () => {
      const tenant = await seedTenant("edit");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asCompany(
        await request(app)
          .post("/api/v1/companies")
          .set("Authorization", authHeader)
          .send({
            name: "Editable Co",
            countryId: tenant.masters.countryId,
            currencyId: tenant.masters.currencyId,
            fiscalYearStartMonth: 1,
            timezone: "UTC",
          }),
      );

      const patchRes = await request(app)
        .patch(`/api/v1/companies/${created.id}`)
        .set("Authorization", authHeader)
        .send({ name: "Renamed Co", status: "inactive" });

      expect(patchRes.status).toBe(200);
      const updated = asCompany(patchRes);
      expect(updated.name).toBe("Renamed Co");
      expect(updated.status).toBe("inactive");

      // No such routes exist at all.
      const activateRes = await request(app).patch(`/api/v1/companies/${created.id}/activate`).set("Authorization", authHeader);
      expect(activateRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects requests without admin.company.read/create",
    async () => {
      const tenant = await seedTenant("forbidden", []);
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const listRes = await request(app).get("/api/v1/companies").set("Authorization", authHeader);
      expect(listRes.status).toBe(403);

      const createRes = await request(app)
        .post("/api/v1/companies")
        .set("Authorization", authHeader)
        .send({ name: "Nope Co", countryId: tenant.masters.countryId, currencyId: tenant.masters.currencyId, fiscalYearStartMonth: 1, timezone: "UTC" });
      expect(createRes.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );
});
