import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool, db } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import { hashPassword } from "../../../core/auth/password.js";
import type { SendMailInput } from "../../../core/notification/mailer.js";
import { resetMailer, setMailer } from "../../../core/notification/mailer.js";
import { signPlatformAdminToken } from "../../../core/platform-auth/jwt.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { tenants } from "../../../database/platform/schema.js";
import { menus, roles, userRoles, users } from "../../../database/tenant/schema.js";
import { insertPlatformAdmin } from "../../../modules/platform/platform.repository.js";
import { provisionTenant } from "../provision-tenant.js";
import { DEFAULT_ROLE_NAMES } from "../seed-roles.js";

const TEST_TIMEOUT_MS = 120_000;

interface CapturedMailer {
  sent: SendMailInput[];
}

function useFakeMailer(): CapturedMailer {
  const captured: CapturedMailer = { sent: [] };
  setMailer({
    send: (input) => {
      captured.sent.push(input);
      return Promise.resolve();
    },
  });
  return captured;
}

function firstSentEmail(mailer: CapturedMailer): SendMailInput {
  const email = mailer.sent[0];
  if (!email) {
    throw new Error("no email was sent");
  }
  return email;
}

function extractToken(email: SendMailInput): string {
  const match = /token=([^\s"<]+)/.exec(email.text);
  if (!match?.[1]) {
    throw new Error(`no token found in email text: ${email.text}`);
  }
  return decodeURIComponent(match[1]);
}

async function seedPlatformAdmin(): Promise<{ id: string; token: string }> {
  const unique = randomUUID().slice(0, 8);
  const passwordHash = await hashPassword("platform-admin-password-1");
  const admin = await insertPlatformAdmin({
    email: `platform-admin-${unique}@example.com`,
    passwordHash,
    name: "Platform Admin",
  });
  const token = await signPlatformAdminToken(admin.id);
  return { id: admin.id, token };
}

function uniqueSlug(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}`;
}

async function schemaExists(schemaName: string): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql`select exists(select 1 from pg_catalog.pg_namespace where nspname = ${schemaName}) as "exists"`,
  );
  return result.rows[0]?.exists ?? false;
}

function app() {
  return createApp();
}

describe("core/provisioning: provisionTenant", () => {
  afterEach(() => {
    resetMailer();
  });

  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "a full provision creates a working schema, migrations, seeded roles, and an invited admin",
    async () => {
      const mailer = useFakeMailer();
      const platformAdmin = await seedPlatformAdmin();
      const slug = uniqueSlug("provision-full");

      const result = await provisionTenant(
        { name: "Full Provision Co", slug, adminEmail: `admin-${slug}@example.com`, adminName: "Ada Admin", modules: ["purchase"] },
        platformAdmin.id,
      );

      expect(result.created).toBe(true);
      expect(await schemaExists(result.schemaName)).toBe(true);

      const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, result.tenantId)).limit(1);
      expect(tenantRow?.status).toBe("active");

      const seededRoles = await withTenantSchema(result.schemaName, (tx) =>
        tx.select({ name: roles.name }).from(roles).where(eq(roles.companyId, result.companyId)),
      );
      expect(new Set(seededRoles.map((r) => r.name))).toEqual(new Set(DEFAULT_ROLE_NAMES));

      const [adminUser] = await withTenantSchema(result.schemaName, (tx) =>
        tx.select().from(users).where(eq(users.id, result.adminUserId)),
      );
      expect(adminUser?.status).toBe("invited");
      expect(adminUser?.email).toBe(`admin-${slug}@example.com`);

      // Not yet assigned: the Admin role is only granted when the invite is
      // accepted (invitations.roles is intent, not an immediate grant -
      // docs/adr/0006), covered end-to-end by the "accept their invite and
      // log in" test below.
      const adminRoleAssignments = await withTenantSchema(result.schemaName, (tx) =>
        tx.select().from(userRoles).where(eq(userRoles.userId, result.adminUserId)),
      );
      expect(adminRoleAssignments).toHaveLength(0);

      const seededMenus = await withTenantSchema(result.schemaName, (tx) =>
        tx.select({ key: menus.key }).from(menus).where(eq(menus.companyId, result.companyId)),
      );
      expect(seededMenus.length).toBeGreaterThan(0);

      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe(`admin-${slug}@example.com`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a re-run against an already-active tenant is a no-op - no duplicate roles, no second invite email",
    async () => {
      const mailer = useFakeMailer();
      const platformAdmin = await seedPlatformAdmin();
      const slug = uniqueSlug("provision-rerun");
      const input = {
        name: "Rerun Co",
        slug,
        adminEmail: `admin-${slug}@example.com`,
        adminName: "Rae Rerun",
        modules: [] as string[],
      };

      const first = await provisionTenant(input, platformAdmin.id);
      expect(first.created).toBe(true);
      expect(mailer.sent).toHaveLength(1);

      const second = await provisionTenant(input, platformAdmin.id);
      expect(second.created).toBe(false);
      expect(second.tenantId).toBe(first.tenantId);
      expect(second.companyId).toBe(first.companyId);
      // No second invite attempt - re-provisioning never re-invites an admin that already exists.
      expect(mailer.sent).toHaveLength(1);

      const roleRows = await withTenantSchema(first.schemaName, (tx) =>
        tx.select({ name: roles.name }).from(roles).where(eq(roles.companyId, first.companyId)),
      );
      // Still exactly one of each default role - re-run must not have tried (and failed, or duplicated) role creation.
      expect(roleRows).toHaveLength(DEFAULT_ROLE_NAMES.length);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a failure partway through leaves no orphan schema and no platform row",
    async () => {
      const platformAdmin = await seedPlatformAdmin();
      const slug = uniqueSlug("provision-failure");
      const schemaName = `tenant_${slug.replace(/-/g, "_")}`;

      // "nonexistent-module" fails inside resolveModuleClosure, which runs
      // late (after schema creation, migrations, company/branch, admin
      // user, roles, and menu tree already exist) - a genuine mid-way
      // failure, not a contrived one at step 1.
      await expect(
        provisionTenant(
          {
            name: "Failure Co",
            slug,
            adminEmail: `admin-${slug}@example.com`,
            adminName: "Fae Failure",
            modules: ["nonexistent-module"],
          },
          platformAdmin.id,
        ),
      ).rejects.toThrow(/unknown module/i);

      expect(await schemaExists(schemaName)).toBe(false);

      const [orphanRow] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      expect(orphanRow).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the provisioned admin can accept their invite and log in",
    async () => {
      const mailer = useFakeMailer();
      const platformAdmin = await seedPlatformAdmin();
      const slug = uniqueSlug("provision-e2e");
      const adminEmail = `admin-${slug}@example.com`;

      const result = await provisionTenant(
        { name: "E2E Co", slug, adminEmail, adminName: "Eve E2E", modules: [] },
        platformAdmin.id,
      );

      const token = extractToken(firstSentEmail(mailer));
      const httpApp = app();

      const acceptRes = await request(httpApp)
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ password: "correct-horse-battery-staple-9", tenantCode: slug });
      expect(acceptRes.status).toBe(204);

      const loginRes = await request(httpApp)
        .post("/api/v1/auth/login")
        .send({ identifier: adminEmail, password: "correct-horse-battery-staple-9", tenantCode: slug });
      expect(loginRes.status).toBe(200);

      const loginBody = z
        .object({ accessToken: z.string(), user: z.object({ id: z.string() }) })
        .parse(loginRes.body);
      expect(loginBody.user.id).toBe(result.adminUserId);

      // The Admin role really did carry through the invite -> accept flow.
      const roleRows = await withTenantSchema(result.schemaName, (tx) =>
        tx
          .select({ name: roles.name })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(and(eq(userRoles.userId, result.adminUserId), eq(roles.name, "Admin"))),
      );
      expect(roleRows).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "POST /api/v1/platform/tenants rejects a request with no platform-admin token",
    async () => {
      const res = await request(app())
        .post("/api/v1/platform/tenants")
        .send({ name: "No Auth Co", slug: uniqueSlug("no-auth"), adminEmail: "x@example.com", adminName: "X", modules: [] });
      expect(res.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "POST /api/v1/platform/tenants succeeds with a valid platform-admin token",
    async () => {
      useFakeMailer();
      const platformAdmin = await seedPlatformAdmin();
      const slug = uniqueSlug("http-provision");

      const res = await request(app())
        .post("/api/v1/platform/tenants")
        .set("Authorization", `Bearer ${platformAdmin.token}`)
        .send({ name: "HTTP Co", slug, adminEmail: `admin-${slug}@example.com`, adminName: "Http Admin", modules: [] });

      expect(res.status).toBe(201);
      const body = z.object({ created: z.literal(true), tenantId: z.string() }).parse(res.body);
      expect(body.tenantId).toBeTruthy();
    },
    TEST_TIMEOUT_MS,
  );
});
