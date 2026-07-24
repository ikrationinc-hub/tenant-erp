import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandler } from "../../../common/middleware/error-handler.js";
import { requireModuleEnabled } from "../../../common/middleware/require-module-enabled.js";
import { requestContextMiddleware } from "../../../common/middleware/request-context.middleware.js";
import { scopeResolverMiddleware } from "../../../common/middleware/scope-resolver.js";
import { closeDbPool } from "../../../config/db.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { closeRedis } from "../../../config/redis.js";
import { companies, users } from "../../../database/tenant/schema.js";
import { setModuleEnabled } from "../tenant-modules.js";
import { resolveLoadOrder } from "../registry.js";
import type { ModuleManifest } from "../types.js";

const TEST_TIMEOUT_MS = 120_000;

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

function stubManifest(key: string, dependsOn: string[] = []): ModuleManifest {
  return { key, name: key, version: "1.0.0", permissions: [], dependsOn, migrations: [] };
}

describe("resolveLoadOrder", () => {
  it("resolves modules so every dependency comes before its dependent", () => {
    const order = resolveLoadOrder([
      stubManifest("c", ["b"]),
      stubManifest("a"),
      stubManifest("b", ["a"]),
    ]);
    expect(order.map((m) => m.key)).toEqual(["a", "b", "c"]);
  });

  it("throws on a dependency that isn't in the manifest list", () => {
    expect(() => resolveLoadOrder([stubManifest("a", ["ghost"])])).toThrow(/unknown module "ghost"/);
  });

  it("throws on a dependency cycle", () => {
    expect(() => resolveLoadOrder([stubManifest("a", ["b"]), stubManifest("b", ["a"])])).toThrow(
      /cycle/,
    );
  });
});

interface SeededUser {
  tenant: ProvisionedTenant;
  companyId: string;
  userId: string;
}

async function seedTenantWithUser(label: string): Promise<SeededUser> {
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
        mobile: `+1${unique}`,
        name: `${label} User`,
        status: "active",
        createdBy: randomUUID(),
      })
      .returning();
    if (!user) {
      throw new Error("failed to insert user");
    }
    return { companyId: company.id, userId: user.id };
  });

  return { tenant, companyId, userId };
}

async function issueAccessToken(seed: SeededUser): Promise<string> {
  const { token } = await signAccessToken({
    sub: seed.userId,
    tenant: seed.tenant.id,
    company_id: seed.companyId,
    roles: [],
    scope: "full",
  });
  return token;
}

function buildTestApp(): express.Express {
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());

  app.get(
    "/probe/users-module",
    scopeResolverMiddleware,
    requireModuleEnabled("users"),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );

  app.use(errorHandler);
  return app;
}

describe("module-registry: requireModuleEnabled", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "a request to a disabled module's route is a 404, not a 403",
    async () => {
      const seed = await seedTenantWithUser("module-disabled");
      const app = buildTestApp();
      const token = await issueAccessToken(seed);

      const before = await request(app)
        .get("/probe/users-module")
        .set("Authorization", `Bearer ${token}`);
      expect(before.status).toBe(200);

      await setModuleEnabled(seed.tenant.id, seed.tenant.schemaName, "users", false);

      const after = await request(app)
        .get("/probe/users-module")
        .set("Authorization", `Bearer ${token}`);
      expect(after.status).toBe(404);
      const body = errorResponseSchema.parse(after.body);
      expect(body.error.code).toBe("NOT_FOUND");
      // Not a permission-shaped error body - nothing here should hint that
      // a "users" module exists at all.
      expect(JSON.stringify(body)).not.toMatch(/module|forbidden/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "re-enabling a module makes its routes reachable again",
    async () => {
      const seed = await seedTenantWithUser("module-reenabled");
      const app = buildTestApp();
      const token = await issueAccessToken(seed);

      await setModuleEnabled(seed.tenant.id, seed.tenant.schemaName, "users", false);
      const disabled = await request(app)
        .get("/probe/users-module")
        .set("Authorization", `Bearer ${token}`);
      expect(disabled.status).toBe(404);

      await setModuleEnabled(seed.tenant.id, seed.tenant.schemaName, "users", true);
      const reenabled = await request(app)
        .get("/probe/users-module")
        .set("Authorization", `Bearer ${token}`);
      expect(reenabled.status).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );
});
