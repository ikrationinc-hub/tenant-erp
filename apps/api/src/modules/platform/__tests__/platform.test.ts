import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { hashPassword } from "../../../core/auth/password.js";
import { signPlatformAdminToken } from "../../../core/platform-auth/jwt.js";
import { resetMailer, setMailer } from "../../../core/notification/mailer.js";
import { provisionTenant } from "../../../core/provisioning/provision-tenant.js";
import { closeTenantDbPool } from "../../../database/get-db.js";
import { insertPlatformAdmin } from "../platform.repository.js";

const TEST_TIMEOUT_MS = 120_000;
const PLATFORM_ADMIN_PASSWORD = "platform-admin-password-1";

function app() {
  return createApp();
}

function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

interface SeededPlatformAdmin {
  id: string;
  email: string;
}

async function seedPlatformAdmin(): Promise<SeededPlatformAdmin> {
  const unique = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword(PLATFORM_ADMIN_PASSWORD);
  const admin = await insertPlatformAdmin({
    email: `platform-admin-${unique}@example.com`,
    passwordHash,
    name: "Platform Admin",
  });
  return { id: admin.id, email: admin.email };
}

async function loginPlatformAdmin(
  admin: SeededPlatformAdmin,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app())
    .post("/api/v1/platform/auth/login")
    .send({ email: admin.email, password: PLATFORM_ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return z.object({ accessToken: z.string(), refreshToken: z.string() }).parse(res.body);
}

async function provisionActiveTenant(label: string, modules: string[] = []) {
  setMailer({ send: () => Promise.resolve() });
  const platformAdmin = await seedPlatformAdmin();
  const slug = uniqueSlug(label);
  const result = await provisionTenant(
    { name: `${label} Co`, slug, adminEmail: `admin-${slug}@example.com`, adminName: "Ada Admin", modules },
    platformAdmin.id,
  );
  resetMailer();
  return { ...result, slug };
}

describe("modules/platform: auth", () => {
  it(
    "login happy path returns an access + refresh token and the admin summary",
    async () => {
      const admin = await seedPlatformAdmin();
      const res = await request(app())
        .post("/api/v1/platform/auth/login")
        .send({ email: admin.email, password: PLATFORM_ADMIN_PASSWORD });

      expect(res.status).toBe(200);
      const body = z
        .object({
          accessToken: z.string(),
          refreshToken: z.string(),
          admin: z.object({ id: z.string(), email: z.string() }),
        })
        .parse(res.body);
      expect(body.admin.id).toBe(admin.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "wrong password and unknown email produce the identical response",
    async () => {
      const admin = await seedPlatformAdmin();

      const wrongPassword = await request(app())
        .post("/api/v1/platform/auth/login")
        .send({ email: admin.email, password: "not-the-right-password" });
      const unknownEmail = await request(app())
        .post("/api/v1/platform/auth/login")
        .send({ email: `nobody-${randomUUID()}@example.com`, password: "whatever-password" });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);

      const errorShape = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
      // Same code + message; requestId legitimately differs per request.
      expect(errorShape.parse(wrongPassword.body).error).toEqual(errorShape.parse(unknownEmail.body).error);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "locks out after repeated failures, independent of whether the account is real",
    async () => {
      const email = `lockout-${randomUUID()}@example.com`;

      for (let i = 0; i < 5; i++) {
        await request(app())
          .post("/api/v1/platform/auth/login")
          .send({ email, password: "wrong-password" });
      }

      const res = await request(app())
        .post("/api/v1/platform/auth/login")
        .send({ email, password: "wrong-password" });

      expect(res.status).toBe(401);
      const body = z.object({ error: z.object({ message: z.string() }) }).parse(res.body);
      expect(body.error.message).toMatch(/too many failed attempts/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refresh rotates the token, and reusing the old refresh token revokes the whole family",
    async () => {
      const admin = await seedPlatformAdmin();
      const first = await loginPlatformAdmin(admin);

      const refreshRes = await request(app())
        .post("/api/v1/platform/auth/refresh")
        .send({ refreshToken: first.refreshToken });
      expect(refreshRes.status).toBe(200);
      const rotated = z.object({ accessToken: z.string(), refreshToken: z.string() }).parse(refreshRes.body);
      expect(rotated.refreshToken).not.toBe(first.refreshToken);

      // Reuse of the original (now-superseded) refresh token is a reuse-
      // detection event: the whole rotation lineage is revoked, so even the
      // freshly-rotated token stops working.
      const reuseRes = await request(app())
        .post("/api/v1/platform/auth/refresh")
        .send({ refreshToken: first.refreshToken });
      expect(reuseRes.status).toBe(401);

      const rotatedAgainRes = await request(app())
        .post("/api/v1/platform/auth/refresh")
        .send({ refreshToken: rotated.refreshToken });
      expect(rotatedAgainRes.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "logout revokes the refresh token family and denylists the access token",
    async () => {
      const admin = await seedPlatformAdmin();
      const tokens = await loginPlatformAdmin(admin);

      const logoutRes = await request(app())
        .post("/api/v1/platform/auth/logout")
        .set("Authorization", `Bearer ${tokens.accessToken}`)
        .send({ refreshToken: tokens.refreshToken });
      expect(logoutRes.status).toBe(204);

      const meAfterLogout = await request(app())
        .get("/api/v1/platform/auth/me")
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(meAfterLogout.status).toBe(401);

      const refreshAfterLogout = await request(app())
        .post("/api/v1/platform/auth/refresh")
        .send({ refreshToken: tokens.refreshToken });
      expect(refreshAfterLogout.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /me returns the admin's own profile, and rejects with no token",
    async () => {
      const admin = await seedPlatformAdmin();
      const tokens = await loginPlatformAdmin(admin);

      const withToken = await request(app())
        .get("/api/v1/platform/auth/me")
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(withToken.status).toBe(200);
      expect(z.object({ id: z.string() }).parse(withToken.body).id).toBe(admin.id);

      const withoutToken = await request(app()).get("/api/v1/platform/auth/me");
      expect(withoutToken.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a tenant access token is REJECTED by the platform API (wrong secret -> 401)",
    async () => {
      const tenantToken = await signAccessToken({
        sub: randomUUID(),
        tenant: randomUUID(),
        company_id: randomUUID(),
        roles: [],
        scope: "full",
      });

      const res = await request(app())
        .get("/api/v1/platform/auth/me")
        .set("Authorization", `Bearer ${tenantToken.token}`);
      expect(res.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a platform admin token is REJECTED by the tenant API (wrong secret -> 401)",
    async () => {
      const admin = await seedPlatformAdmin();
      const platformToken = await signPlatformAdminToken(admin.id);

      const res = await request(app())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${platformToken}`);
      expect(res.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("modules/platform: tenant administration", () => {
  afterEach(() => {
    resetMailer();
  });

  it(
    "every /platform/tenants endpoint 401s without a platform-admin token",
    async () => {
      const httpApp = app();
      const tenantId = randomUUID();

      const results = await Promise.all([
        request(httpApp).get("/api/v1/platform/tenants"),
        request(httpApp).get(`/api/v1/platform/tenants/${tenantId}`),
        request(httpApp).post(`/api/v1/platform/tenants/${tenantId}/suspend`),
        request(httpApp).post(`/api/v1/platform/tenants/${tenantId}/reactivate`),
        request(httpApp).get(`/api/v1/platform/tenants/${tenantId}/modules`),
        request(httpApp).patch(`/api/v1/platform/tenants/${tenantId}/modules`).send({ moduleKey: "menus", enabled: false }),
      ]);

      for (const res of results) {
        expect(res.status).toBe(401);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /platform/tenants lists a provisioned tenant with its module and user counts",
    async () => {
      const provisioned = await provisionActiveTenant("list-tenants", ["purchase"]);
      const platformAdmin = await seedPlatformAdmin();
      const tokens = await loginPlatformAdmin(platformAdmin);

      const res = await request(app())
        .get("/api/v1/platform/tenants")
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(res.status).toBe(200);

      const body = z
        .object({
          tenants: z.array(
            z.object({ id: z.string(), slug: z.string(), moduleCount: z.number(), userCount: z.number() }),
          ),
        })
        .parse(res.body);
      const row = body.tenants.find((t) => t.id === provisioned.tenantId);
      expect(row).toBeDefined();
      expect(row?.moduleCount).toBeGreaterThan(0);
      expect(row?.userCount).toBeGreaterThanOrEqual(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /platform/tenants/:id returns tenant metadata and modules, 404s for an unknown id",
    async () => {
      const provisioned = await provisionActiveTenant("get-tenant");
      const platformAdmin = await seedPlatformAdmin();
      const tokens = await loginPlatformAdmin(platformAdmin);
      const httpApp = app();

      const found = await request(httpApp)
        .get(`/api/v1/platform/tenants/${provisioned.tenantId}`)
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(found.status).toBe(200);
      const foundBody = z.object({ id: z.string(), modules: z.array(z.unknown()) }).parse(found.body);
      expect(foundBody.id).toBe(provisioned.tenantId);

      const notFound = await request(httpApp)
        .get(`/api/v1/platform/tenants/${randomUUID()}`)
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(notFound.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "suspend blocks that tenant's user login; reactivate restores it",
    async () => {
      const provisioned = await provisionActiveTenant("suspend-flow");
      const platformAdmin = await seedPlatformAdmin();
      const tokens = await loginPlatformAdmin(platformAdmin);
      const httpApp = app();

      const suspendRes = await request(httpApp)
        .post(`/api/v1/platform/tenants/${provisioned.tenantId}/suspend`)
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(suspendRes.status).toBe(200);
      expect(z.object({ status: z.string() }).parse(suspendRes.body).status).toBe("suspended");

      // Suspended tenants resolve to no active tenant at all - login must
      // fail the same generic way an unresolved tenant does.
      const loginWhileSuspended = await request(httpApp)
        .post("/api/v1/auth/login")
        .send({
          identifier: `admin-${provisioned.slug}@example.com`,
          password: "irrelevant",
          tenantCode: provisioned.slug,
        });
      expect(loginWhileSuspended.status).toBe(401);

      // Suspending an already-suspended tenant is a conflict, not a no-op.
      const doubleSuspend = await request(httpApp)
        .post(`/api/v1/platform/tenants/${provisioned.tenantId}/suspend`)
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(doubleSuspend.status).toBe(409);

      const reactivateRes = await request(httpApp)
        .post(`/api/v1/platform/tenants/${provisioned.tenantId}/reactivate`)
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(reactivateRes.status).toBe(200);
      expect(z.object({ status: z.string() }).parse(reactivateRes.body).status).toBe("active");

      const doubleReactivate = await request(httpApp)
        .post(`/api/v1/platform/tenants/${provisioned.tenantId}/reactivate`)
        .set("Authorization", `Bearer ${tokens.accessToken}`);
      expect(doubleReactivate.status).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET .../modules lists the full catalogue with enabled flags; PATCH toggles one and persists",
    async () => {
      // "menus" explicitly requested - it's not in ALWAYS_ENABLED_MODULE_KEYS
      // (only health/auth are), so a tenant provisioned with modules: []
      // would never have it enabled to begin with.
      const provisioned = await provisionActiveTenant("modules-flow", ["menus"]);
      const platformAdmin = await seedPlatformAdmin();
      const tokens = await loginPlatformAdmin(platformAdmin);
      const httpApp = app();
      const authHeader = `Bearer ${tokens.accessToken}`;

      const listRes = await request(httpApp)
        .get(`/api/v1/platform/tenants/${provisioned.tenantId}/modules`)
        .set("Authorization", authHeader);
      expect(listRes.status).toBe(200);
      const modules = z
        .object({ modules: z.array(z.object({ key: z.string(), enabled: z.boolean() })) })
        .parse(listRes.body).modules;
      const menusModule = modules.find((m) => m.key === "menus");
      expect(menusModule?.enabled).toBe(true);

      const patchRes = await request(httpApp)
        .patch(`/api/v1/platform/tenants/${provisioned.tenantId}/modules`)
        .set("Authorization", authHeader)
        .send({ moduleKey: "menus", enabled: false });
      expect(patchRes.status).toBe(200);

      const afterPatch = await request(httpApp)
        .get(`/api/v1/platform/tenants/${provisioned.tenantId}/modules`)
        .set("Authorization", authHeader);
      const afterModules = z
        .object({ modules: z.array(z.object({ key: z.string(), enabled: z.boolean() })) })
        .parse(afterPatch.body).modules;
      expect(afterModules.find((m) => m.key === "menus")?.enabled).toBe(false);

      const unknownModuleRes = await request(httpApp)
        .patch(`/api/v1/platform/tenants/${provisioned.tenantId}/modules`)
        .set("Authorization", authHeader)
        .send({ moduleKey: "not-a-real-module", enabled: true });
      expect(unknownModuleRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );
});

// A single top-level afterAll, not one per describe: closeDbPool/
// closeTenantDbPool/closeRedis tear down module-level singletons shared by
// every test in this file - closing them after the first describe block
// finishes would break every test in the second.
afterAll(async () => {
  await closeTenantDbPool();
  await closeDbPool();
  await closeRedis();
});
