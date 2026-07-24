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
import { companies, permissions, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;

const masterRowSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number(),
});

const paginatedResponseSchema = z.object({
  items: z.array(masterRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const optionsResponseSchema = z.object({
  options: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      parentValue: z.string().optional(),
    }),
  ),
});

function asMasterRow(res: { body: unknown }) {
  return masterRowSchema.parse(res.body);
}
function asPaginated(res: { body: unknown }) {
  return paginatedResponseSchema.parse(res.body);
}
function asOptions(res: { body: unknown }) {
  return optionsResponseSchema.parse(res.body);
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) =>
    tx.select().from(permissions).where(eq(permissions.key, key)).limit(1),
  );
  if (!row) {
    throw new Error(`expected permission ${key} to exist in the seeded catalogue`);
  }
  return row.id;
}

interface SeededAdmin {
  schemaName: string;
  companyId: string;
  userId: string;
  accessToken: string;
}

async function seedTenantWithAdmin(label: string, permissionKeys: string[]): Promise<SeededAdmin> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
      .values({
        companyId: company.id,
        email: `${label}-${unique}@example.com`,
        name: `${label} Admin`,
        status: "active",
        createdBy: randomUUID(),
      })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  const role = await createRole({
    schemaName: tenant.schemaName,
    companyId,
    name: `${label}-role`,
    createdBy: userId,
  });
  await assignRoleToUser(tenant.schemaName, companyId, userId, role.id, userId);
  for (const key of permissionKeys) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, userId);
  }

  const { token } = await signAccessToken({
    sub: userId,
    tenant: tenant.id,
    company_id: companyId,
    roles: [],
    scope: "full",
  });

  return { schemaName: tenant.schemaName, companyId, userId, accessToken: token };
}

function allPermissionsFor(entity: string): string[] {
  return [`masters.${entity}.create`, `masters.${entity}.read`, `masters.${entity}.update`];
}

describe("core/masters - generic master-data pattern", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "generic CRUD works identically across three different masters (country, currency, uom) with zero master-specific code",
    async () => {
      const masters = [
        { urlSegment: "countries", entity: "country", code: "US", name: "United States", renamed: "United States of America" },
        { urlSegment: "currencies", entity: "currency", code: "USD", name: "US Dollar", renamed: "United States Dollar" },
        { urlSegment: "uom", entity: "uom", code: "MT", name: "Metric Ton", renamed: "Metric Tonne" },
      ];

      for (const master of masters) {
        const admin = await seedTenantWithAdmin(`crud-${master.entity}`, allPermissionsFor(master.entity));
        const app = createApp();
        const authHeader = `Bearer ${admin.accessToken}`;

        const createRes = await request(app)
          .post(`/api/v1/masters/${master.urlSegment}`)
          .set("Authorization", authHeader)
          .send({ code: master.code, name: master.name });
        expect(createRes.status).toBe(201);
        const created = asMasterRow(createRes);
        expect(created.code).toBe(master.code);
        expect(created.name).toBe(master.name);
        expect(created.isActive).toBe(true);

        const getRes = await request(app)
          .get(`/api/v1/masters/${master.urlSegment}/${created.id}`)
          .set("Authorization", authHeader);
        expect(getRes.status).toBe(200);
        expect(asMasterRow(getRes).id).toBe(created.id);

        const updateRes = await request(app)
          .patch(`/api/v1/masters/${master.urlSegment}/${created.id}`)
          .set("Authorization", authHeader)
          .send({ name: master.renamed });
        expect(updateRes.status).toBe(200);
        expect(asMasterRow(updateRes).name).toBe(master.renamed);

        const listRes = await request(app)
          .get(`/api/v1/masters/${master.urlSegment}`)
          .set("Authorization", authHeader);
        expect(listRes.status).toBe(200);
        const list = asPaginated(listRes);
        expect(list.items.some((row) => row.id === created.id)).toBe(true);

        // Duplicate code is a 409, not a second row - the reference case CLAUDE.md rule 5's generic uniqueness guard.
        const duplicateRes = await request(app)
          .post(`/api/v1/masters/${master.urlSegment}`)
          .set("Authorization", authHeader)
          .send({ code: master.code, name: "A different name" });
        expect(duplicateRes.status).toBe(409);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "cascading filter: cities are scoped to a country via parentValue on both the list and options endpoints",
    async () => {
      const admin = await seedTenantWithAdmin("cascade", [...allPermissionsFor("country"), ...allPermissionsFor("city")]);
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      const countryA = asMasterRow(
        await request(app).post("/api/v1/masters/countries").set("Authorization", authHeader).send({ code: "AE", name: "UAE" }),
      );
      const countryB = asMasterRow(
        await request(app).post("/api/v1/masters/countries").set("Authorization", authHeader).send({ code: "SG", name: "Singapore" }),
      );

      await request(app)
        .post("/api/v1/masters/cities")
        .set("Authorization", authHeader)
        .send({ code: "DXB", name: "Dubai", countryId: countryA.id });
      await request(app)
        .post("/api/v1/masters/cities")
        .set("Authorization", authHeader)
        .send({ code: "AUH", name: "Abu Dhabi", countryId: countryA.id });
      await request(app)
        .post("/api/v1/masters/cities")
        .set("Authorization", authHeader)
        .send({ code: "SIN", name: "Singapore City", countryId: countryB.id });

      const listRes = await request(app)
        .get("/api/v1/masters/cities")
        .query({ parentValue: countryA.id })
        .set("Authorization", authHeader);
      const list = asPaginated(listRes);
      expect(list.items).toHaveLength(2);
      expect(list.items.map((c) => c.code).sort()).toEqual(["AUH", "DXB"]);

      const optionsRes = await request(app)
        .get("/api/v1/masters/cities/options")
        .query({ parentValue: countryA.id })
        .set("Authorization", authHeader);
      const options = asOptions(optionsRes);
      expect(options.options).toHaveLength(2);
      expect(options.options.every((o) => o.parentValue === countryA.id)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "deactivate hides a record from the options dropdown while GET by id (an existing reference) still resolves it",
    async () => {
      const admin = await seedTenantWithAdmin("deactivate", allPermissionsFor("port"));
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      const port = asMasterRow(
        await request(app)
          .post("/api/v1/masters/ports")
          .set("Authorization", authHeader)
          .send({ code: "JEA", name: "Jebel Ali" }),
      );

      const before = asOptions(await request(app).get("/api/v1/masters/ports/options").set("Authorization", authHeader));
      expect(before.options.some((o) => o.value === port.id)).toBe(true);

      const deactivateRes = await request(app)
        .patch(`/api/v1/masters/ports/${port.id}/deactivate`)
        .set("Authorization", authHeader);
      expect(deactivateRes.status).toBe(200);
      expect(asMasterRow(deactivateRes).isActive).toBe(false);

      const after = asOptions(await request(app).get("/api/v1/masters/ports/options").set("Authorization", authHeader));
      expect(after.options.some((o) => o.value === port.id)).toBe(false);

      // The row itself - an existing reference to it - is still resolvable, never hard-deleted.
      const getRes = await request(app).get(`/api/v1/masters/ports/${port.id}`).set("Authorization", authHeader);
      expect(getRes.status).toBe(200);
      expect(asMasterRow(getRes).id).toBe(port.id);

      const reactivateRes = await request(app)
        .patch(`/api/v1/masters/ports/${port.id}/activate`)
        .set("Authorization", authHeader);
      expect(asMasterRow(reactivateRes).isActive).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list is paginated server-side",
    async () => {
      const admin = await seedTenantWithAdmin("pagination", allPermissionsFor("vessel"));
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      for (let i = 0; i < 5; i += 1) {
        await request(app)
          .post("/api/v1/masters/vessels")
          .set("Authorization", authHeader)
          .send({ code: `V${i}`, name: `Vessel ${i}`, sortOrder: i });
      }

      const page1 = asPaginated(
        await request(app).get("/api/v1/masters/vessels").query({ page: 1, pageSize: 2 }).set("Authorization", authHeader),
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(2);

      const page3 = asPaginated(
        await request(app).get("/api/v1/masters/vessels").query({ page: 3, pageSize: 2 }).set("Authorization", authHeader),
      );
      expect(page3.items).toHaveLength(1);

      const allCodes = new Set<string>();
      for (let page = 1; page <= 3; page += 1) {
        const res = asPaginated(
          await request(app).get("/api/v1/masters/vessels").query({ page, pageSize: 2 }).set("Authorization", authHeader),
        );
        for (const row of res.items) {
          allCodes.add(row.code);
        }
      }
      expect(allCodes.size).toBe(5);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "list supports search by name or code",
    async () => {
      const admin = await seedTenantWithAdmin("search", allPermissionsFor("incoterm"));
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      await request(app)
        .post("/api/v1/masters/incoterms")
        .set("Authorization", authHeader)
        .send({ code: "FOB", name: "Free on Board" });
      await request(app)
        .post("/api/v1/masters/incoterms")
        .set("Authorization", authHeader)
        .send({ code: "CIF", name: "Cost, Insurance and Freight" });
      await request(app)
        .post("/api/v1/masters/incoterms")
        .set("Authorization", authHeader)
        .send({ code: "EXW", name: "Ex Works" });

      const byName = asPaginated(
        await request(app).get("/api/v1/masters/incoterms").query({ search: "Freight" }).set("Authorization", authHeader),
      );
      expect(byName.items).toHaveLength(1);
      expect(byName.items[0]?.code).toBe("CIF");

      const byCode = asPaginated(
        await request(app).get("/api/v1/masters/incoterms").query({ search: "fob" }).set("Authorization", authHeader),
      );
      expect(byCode.items).toHaveLength(1);
      expect(byCode.items[0]?.code).toBe("FOB");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the field engine resolves masters.<entity> Tier-2 fields, including a master's extra column (cities' countryId)",
    async () => {
      const admin = await seedTenantWithAdmin("field-engine", ["field_definitions.field.read"]);
      const app = createApp();
      const authHeader = `Bearer ${admin.accessToken}`;

      const res = await request(app).get("/api/v1/field-definitions/masters/city").set("Authorization", authHeader);
      expect(res.status).toBe(200);
      const fieldKeys = (res.body as { fields: { fieldKey: string }[] }).fields.map((f) => f.fieldKey);
      expect(fieldKeys).toEqual(expect.arrayContaining(["code", "name", "isActive", "countryId"]));
    },
    TEST_TIMEOUT_MS,
  );
});
