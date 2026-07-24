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
import { companies, users, permissions } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const branchRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string(),
  code: z.string(),
  status: z.enum(["active", "inactive"]),
});

const paginatedResponseSchema = z.object({
  items: z.array(branchRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

function asBranch(res: { body: unknown }) {
  return branchRowSchema.parse(res.body);
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
  otherCompanyId: string;
  userId: string;
  accessToken: string;
}

const ALL_BRANCH_PERMISSIONS = ["admin.branch.create", "admin.branch.read", "admin.branch.update"];

async function seedTenant(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, otherCompanyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ name: `${label} Co`, fiscalYearStartMonth: 1, timezone: "America/New_York", createdBy: randomUUID() })
      .returning();
    const [otherCompany] = await tx
      .insert(companies)
      .values({ name: `${label} Other Co`, fiscalYearStartMonth: 1, timezone: "UTC", createdBy: randomUUID() })
      .returning();
    if (!company || !otherCompany) {
      throw new Error("failed to insert company");
    }
    const [user] = await tx
      .insert(users)
      .values({ companyId: company.id, email: `${label}-${unique}@example.com`, name: `${label} Admin`, status: "active", createdBy: randomUUID() })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }

    return { companyId: company.id, otherCompanyId: otherCompany.id, userId: user.id };
  });

  const role = await createRole({ schemaName: tenant.schemaName, companyId, name: `${label}-role`, createdBy: userId });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of ALL_BRANCH_PERMISSIONS) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({ sub: userId, tenant: tenant.id, company_id: companyId, roles: [], scope: "full" });

  return { schemaName: tenant.schemaName, companyId, otherCompanyId, userId, accessToken: token };
}

describe("modules/branches - tenant-admin API surface", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "creates a branch, injecting company_id from tenant scope - a stray companyId in the body is rejected outright, never silently honored",
    async () => {
      const tenant = await seedTenant("create");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      // A stray companyId isn't just ignored - `.strict()` 422s the whole
      // request, an even stronger guarantee than silently dropping it.
      const strayFieldRes = await request(app)
        .post("/api/v1/branches")
        .set("Authorization", authHeader)
        .send({ name: "Jebel Ali Warehouse", code: "DXB-JAW", companyId: tenant.otherCompanyId });
      expect(strayFieldRes.status).toBe(422);

      const res = await request(app)
        .post("/api/v1/branches")
        .set("Authorization", authHeader)
        .send({ name: "Jebel Ali Warehouse", code: "DXB-JAW" });

      expect(res.status).toBe(201);
      const created = asBranch(res);
      expect(created.companyId).toBe(tenant.companyId);
      expect(created.companyId).not.toBe(tenant.otherCompanyId);
      expect(created.status).toBe("active");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lists only branches for the caller's own company, and paginates server-side",
    async () => {
      const tenant = await seedTenant("list");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post("/api/v1/branches")
          .set("Authorization", authHeader)
          .send({ name: `Branch ${i}`, code: `BR-${i}` });
      }

      const listRes = asPaginated(await request(app).get("/api/v1/branches").query({ page: 1, pageSize: 2 }).set("Authorization", authHeader));
      expect(listRes.items).toHaveLength(2);
      expect(listRes.total).toBe(3);
      expect(listRes.items.every((row) => row.companyId === tenant.companyId)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rejects a duplicate branch code within the same company, edits via PATCH",
    async () => {
      const tenant = await seedTenant("dup-code");
      const app = createApp();
      const authHeader = `Bearer ${tenant.accessToken}`;

      const created = asBranch(
        await request(app).post("/api/v1/branches").set("Authorization", authHeader).send({ name: "HQ", code: "HQ-1" }),
      );

      const dupRes = await request(app).post("/api/v1/branches").set("Authorization", authHeader).send({ name: "Other", code: "HQ-1" });
      expect(dupRes.status).toBe(409);

      const patchRes = await request(app)
        .patch(`/api/v1/branches/${created.id}`)
        .set("Authorization", authHeader)
        .send({ name: "HQ Renamed", status: "inactive" });
      expect(patchRes.status).toBe(200);
      const updated = asBranch(patchRes);
      expect(updated.name).toBe("HQ Renamed");
      expect(updated.status).toBe("inactive");
      expect(updated.code).toBe("HQ-1");
    },
    TEST_TIMEOUT_MS,
  );
});
