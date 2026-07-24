import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { closeRedis } from "../../../config/redis.js";
import type { SendMailInput } from "../../../core/notification/mailer.js";
import { resetMailer, setMailer } from "../../../core/notification/mailer.js";
import {
  assignRoleToUser,
  createRole,
  grantPermissionToRole,
} from "../../../core/rbac/mutations.js";
import { hashInviteToken } from "../../../core/auth/invite-token.js";
import { signAccessToken } from "../../../core/auth/jwt.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, invitations, permissions, users } from "../../../database/tenant/schema.js";
import { eq } from "drizzle-orm";

const TEST_TIMEOUT_MS = 120_000;
const GOOD_PASSWORD = "purple-hippo-lantern-42";
const OTHER_GOOD_PASSWORD = "Sunshine-Meadow-77Falcon";

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

const inviteResponseSchema = z.object({
  invitationId: z.string(),
  userId: z.string(),
});

const validateInvitationResponseSchema = z.object({
  email: z.string(),
  companyName: z.string(),
});

const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  mustChangePassword: z.boolean(),
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string(),
    companyId: z.string(),
  }),
});

const provisionResponseSchema = z.object({ userId: z.string() });

const userListRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  status: z.enum(["invited", "active", "suspended"]),
  lastLoginAt: z.string().nullable(),
  roleIds: z.array(z.string()),
  invitationId: z.string().nullable(),
  invitationExpiresAt: z.string().nullable(),
});
const paginatedUsersResponseSchema = z.object({
  items: z.array(userListRowSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

const safeUserResponseSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  name: z.string(),
  status: z.enum(["invited", "active", "suspended"]),
  lastLoginAt: z.string().nullable(),
});

function asPaginatedUsers(res: { body: unknown }) {
  return paginatedUsersResponseSchema.parse(res.body);
}
function asSafeUser(res: { body: unknown }) {
  return safeUserResponseSchema.parse(res.body);
}

const myPermissionsResponseSchema = z.object({ permissions: z.array(z.string()) });
function asMyPermissions(res: { body: unknown }) {
  return myPermissionsResponseSchema.parse(res.body);
}

const changePasswordResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  mustChangePassword: z.literal(false),
});

function asError(res: { body: unknown }) {
  return errorResponseSchema.parse(res.body);
}
function asInvite(res: { body: unknown }) {
  return inviteResponseSchema.parse(res.body);
}
function asValidateInvitation(res: { body: unknown }) {
  return validateInvitationResponseSchema.parse(res.body);
}
function asLogin(res: { body: unknown }) {
  return loginResponseSchema.parse(res.body);
}
function asProvision(res: { body: unknown }) {
  return provisionResponseSchema.parse(res.body);
}
function asChangePassword(res: { body: unknown }) {
  return changePasswordResponseSchema.parse(res.body);
}

function app() {
  return createApp();
}

interface CapturedMailer {
  sent: SendMailInput[];
}

/** Test-only seam (core/notification/mailer.ts) - captures sends in-process instead of hitting the real Resend API. */
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
  const match = /\/accept-invitation\/([^\s"<?]+)/.exec(email.text);
  if (!match?.[1]) {
    throw new Error("no token found in captured email");
  }
  return decodeURIComponent(match[1]);
}

interface SeededAdmin {
  tenant: ProvisionedTenant;
  companyId: string;
  adminUserId: string;
  adminEmail: string;
  accessToken: string;
}

async function seedTenantWithAdmin(label: string, permissionKeys: string[]): Promise<SeededAdmin> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });
  const adminEmail = `${label}-admin-${unique}@example.com`;

  const { companyId, adminUserId } = await withTenantSchema(tenant.schemaName, async (tx) => {
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

    const [admin] = await tx
      .insert(users)
      .values({
        companyId: company.id,
        email: adminEmail,
        mobile: `+1${unique}`,
        name: `${label} Admin`,
        status: "active",
        createdBy: randomUUID(),
      })
      .returning();
    if (!admin) {
      throw new Error("failed to insert admin user");
    }

    return { companyId: company.id, adminUserId: admin.id };
  });

  const role = await createRole({
    schemaName: tenant.schemaName,
    companyId,
    name: `${label}-admin-role`,
    createdBy: adminUserId,
  });
  await assignRoleToUser(tenant.schemaName, companyId, adminUserId, role.id, adminUserId);

  for (const key of permissionKeys) {
    const permissionId = await findPermissionId(tenant.schemaName, key);
    await grantPermissionToRole(tenant.schemaName, companyId, role.id, permissionId, adminUserId);
  }

  // The seeded admin has no password set (invite/provision are what we're
  // testing) - mint an access token directly, mirroring rbac.test.ts.
  const { token: accessToken } = await signAccessToken({
    sub: adminUserId,
    tenant: tenant.id,
    company_id: companyId,
    roles: [],
    scope: "full",
  });

  return { tenant, companyId, adminUserId, adminEmail, accessToken };
}

async function findPermissionId(schemaName: string, key: string): Promise<string> {
  const [row] = await withTenantSchema(schemaName, (tx) =>
    tx.select().from(permissions).where(eq(permissions.key, key)).limit(1),
  );
  if (!row) {
    throw new Error(`expected "${key}" to already be seeded by the provisioner`);
  }
  return row.id;
}

describe("user onboarding: invitations, provisioning, password-change scope", () => {
  afterEach(() => {
    resetMailer();
  });

  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "full invite -> accept -> login",
    async () => {
      const admin = await seedTenantWithAdmin("invite-flow", ["users.user.create"]);
      const mailer = useFakeMailer();
      const inviteeEmail = `invitee-${randomUUID().slice(0, 8)}@example.com`;

      const inviteRes = await request(app())
        .post("/api/v1/users/invite")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ email: inviteeEmail, mobile: `+1${randomUUID().slice(0, 8)}`, name: "New Hire", roles: [] });

      expect(inviteRes.status).toBe(201);
      asInvite(inviteRes);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe(inviteeEmail);

      const token = extractToken(firstSentEmail(mailer));

      const validateRes = await request(app())
        .get(`/api/v1/invitations/${token}`)
        .query({ tenantCode: admin.tenant.slug });

      expect(validateRes.status).toBe(200);
      const validated = asValidateInvitation(validateRes);
      expect(validated.email).toBe(inviteeEmail);
      expect(validated.companyName).toBe(admin.tenant.name);

      const acceptRes = await request(app())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ password: GOOD_PASSWORD, tenantCode: admin.tenant.slug });

      expect(acceptRes.status).toBe(204);

      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: inviteeEmail, password: GOOD_PASSWORD, tenantCode: admin.tenant.slug });

      expect(loginRes.status).toBe(200);
      const login = asLogin(loginRes);
      expect(login.mustChangePassword).toBe(false);
      expect(login.refreshToken).toBeDefined();
      expect(login.user.email).toBe(inviteeEmail);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an expired invitation token is rejected",
    async () => {
      const admin = await seedTenantWithAdmin("expired-flow", ["users.user.create"]);
      const mailer = useFakeMailer();
      const inviteeEmail = `invitee-${randomUUID().slice(0, 8)}@example.com`;

      const inviteRes = await request(app())
        .post("/api/v1/users/invite")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ email: inviteeEmail, mobile: `+1${randomUUID().slice(0, 8)}`, name: "New Hire", roles: [] });
      expect(inviteRes.status).toBe(201);
      const token = extractToken(firstSentEmail(mailer));

      // Backdate expires_at directly - the public API has no way to produce
      // an already-expired invitation, so we reach into the DB the same way
      // the migration-runner tests reach into schemas directly.
      await withTenantSchema(admin.tenant.schemaName, (tx) =>
        tx
          .update(invitations)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(invitations.tokenHash, hashInviteToken(token))),
      );

      const validateRes = await request(app())
        .get(`/api/v1/invitations/${token}`)
        .query({ tenantCode: admin.tenant.slug });
      expect(validateRes.status).toBe(404);

      const acceptRes = await request(app())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ password: GOOD_PASSWORD, tenantCode: admin.tenant.slug });
      expect(acceptRes.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an already-accepted (reused) invitation token is rejected",
    async () => {
      const admin = await seedTenantWithAdmin("reuse-flow", ["users.user.create"]);
      const mailer = useFakeMailer();
      const inviteeEmail = `invitee-${randomUUID().slice(0, 8)}@example.com`;

      await request(app())
        .post("/api/v1/users/invite")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ email: inviteeEmail, mobile: `+1${randomUUID().slice(0, 8)}`, name: "New Hire", roles: [] });
      const token = extractToken(firstSentEmail(mailer));

      const firstAccept = await request(app())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ password: GOOD_PASSWORD, tenantCode: admin.tenant.slug });
      expect(firstAccept.status).toBe(204);

      const secondAccept = await request(app())
        .post(`/api/v1/invitations/${token}/accept`)
        .send({ password: OTHER_GOOD_PASSWORD, tenantCode: admin.tenant.slug });
      expect(secondAccept.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an admin cannot send a password on invite",
    async () => {
      const admin = await seedTenantWithAdmin("no-password-flow", ["users.user.create"]);
      useFakeMailer();

      const res = await request(app())
        .post("/api/v1/users/invite")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({
          email: `invitee-${randomUUID().slice(0, 8)}@example.com`,
          mobile: `+1${randomUUID().slice(0, 8)}`,
          name: "New Hire",
          roles: [],
          password: "sneaky-admin-supplied-password",
        });

      expect(res.status).toBe(422);
      expect(asError(res).error.code).toBe("VALIDATION_ERROR");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the provision path rejects a role holding an approval permission",
    async () => {
      const admin = await seedTenantWithAdmin("provision-reject-flow", [
        "users.user.provision",
      ]);

      const approverRole = await createRole({
        schemaName: admin.tenant.schemaName,
        companyId: admin.companyId,
        name: "Approver",
        createdBy: admin.adminUserId,
      });
      const approvePermissionId = await findPermissionId(admin.tenant.schemaName, "purchase.po.approve");
      await grantPermissionToRole(
        admin.tenant.schemaName,
        admin.companyId,
        approverRole.id,
        approvePermissionId,
        admin.adminUserId,
      );

      const res = await request(app())
        .post("/api/v1/users/provision")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({
          name: "Ops Staffer",
          mobile: `+1${randomUUID().slice(0, 8)}`,
          tempPassword: GOOD_PASSWORD,
          roles: [approverRole.id],
        });

      expect(res.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "must_change_password blocks other endpoints until the password is changed",
    async () => {
      const admin = await seedTenantWithAdmin("must-change-flow", ["users.user.provision"]);
      const mobile = `+1${randomUUID().slice(0, 8)}`;

      const provisionRes = await request(app())
        .post("/api/v1/users/provision")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ name: "Ops Staffer", mobile, tempPassword: GOOD_PASSWORD, roles: [] });

      expect(provisionRes.status).toBe(201);
      asProvision(provisionRes);

      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: mobile, password: GOOD_PASSWORD, tenantCode: admin.tenant.slug });

      expect(loginRes.status).toBe(200);
      const login = asLogin(loginRes);
      expect(login.mustChangePassword).toBe(true);
      expect(login.refreshToken).toBeUndefined();

      const blockedRes = await request(app())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.accessToken}`);
      expect(blockedRes.status).toBe(403);

      const changeRes = await request(app())
        .post("/api/v1/users/me/password")
        .set("Authorization", `Bearer ${login.accessToken}`)
        .send({ newPassword: OTHER_GOOD_PASSWORD });

      expect(changeRes.status).toBe(200);
      asChangePassword(changeRes);

      const secondLoginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: mobile, password: OTHER_GOOD_PASSWORD, tenantCode: admin.tenant.slug });
      expect(secondLoginRes.status).toBe(200);
      expect(asLogin(secondLoginRes).mustChangePassword).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /users lists users filtered by status and roleId, never leaking passwordHash",
    async () => {
      const admin = await seedTenantWithAdmin("list-flow", ["users.user.read", "users.user.provision"]);

      const targetRole = await createRole({
        schemaName: admin.tenant.schemaName,
        companyId: admin.companyId,
        name: "Target Role",
        createdBy: admin.adminUserId,
      });
      const otherRole = await createRole({
        schemaName: admin.tenant.schemaName,
        companyId: admin.companyId,
        name: "Other Role",
        createdBy: admin.adminUserId,
      });

      const provisionOne = await request(app())
        .post("/api/v1/users/provision")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ name: "Targeted User", mobile: `+1${randomUUID().slice(0, 8)}`, tempPassword: GOOD_PASSWORD, roles: [targetRole.id] });
      expect(provisionOne.status).toBe(201);

      const provisionTwo = await request(app())
        .post("/api/v1/users/provision")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ name: "Other User", mobile: `+1${randomUUID().slice(0, 8)}`, tempPassword: GOOD_PASSWORD, roles: [otherRole.id] });
      expect(provisionTwo.status).toBe(201);

      const listRes = await request(app()).get("/api/v1/users").set("Authorization", `Bearer ${admin.accessToken}`);
      expect(listRes.status).toBe(200);
      expect(JSON.stringify(listRes.body)).not.toContain("passwordHash");
      asPaginatedUsers(listRes);

      const byStatus = asPaginatedUsers(
        await request(app())
          .get("/api/v1/users")
          .query({ status: "active" })
          .set("Authorization", `Bearer ${admin.accessToken}`),
      );
      expect(byStatus.items.every((row) => row.status === "active")).toBe(true);

      const byRole = asPaginatedUsers(
        await request(app())
          .get("/api/v1/users")
          .query({ roleId: targetRole.id })
          .set("Authorization", `Bearer ${admin.accessToken}`),
      );
      expect(byRole.items).toHaveLength(1);
      expect(byRole.items[0]?.name).toBe("Targeted User");
      expect(byRole.items[0]?.roleIds).toEqual([targetRole.id]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "suspend/reactivate flip a user's status, and PUT roles diffs grant/revoke and takes effect immediately",
    async () => {
      const admin = await seedTenantWithAdmin("suspend-flow", ["users.user.provision", "users.user.update", "users.user.read"]);

      const roleA = await createRole({ schemaName: admin.tenant.schemaName, companyId: admin.companyId, name: "Role A", createdBy: admin.adminUserId });
      const roleB = await createRole({ schemaName: admin.tenant.schemaName, companyId: admin.companyId, name: "Role B", createdBy: admin.adminUserId });

      const provisionRes = await request(app())
        .post("/api/v1/users/provision")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ name: "Suspendable User", mobile: `+1${randomUUID().slice(0, 8)}`, tempPassword: GOOD_PASSWORD, roles: [roleA.id] });
      expect(provisionRes.status).toBe(201);
      const userId = asProvision(provisionRes).userId;

      const suspendRes = await request(app())
        .patch(`/api/v1/users/${userId}/suspend`)
        .set("Authorization", `Bearer ${admin.accessToken}`);
      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body).not.toHaveProperty("passwordHash");
      expect(asSafeUser(suspendRes).status).toBe("suspended");

      const reactivateRes = await request(app())
        .patch(`/api/v1/users/${userId}/reactivate`)
        .set("Authorization", `Bearer ${admin.accessToken}`);
      expect(reactivateRes.status).toBe(200);
      expect(asSafeUser(reactivateRes).status).toBe("active");

      // The full desired set is [roleB] - roleA must be revoked, roleB granted.
      const setRolesRes = await request(app())
        .put(`/api/v1/users/${userId}/roles`)
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send({ roleIds: [roleB.id] });
      expect(setRolesRes.status).toBe(200);

      const listRes = asPaginatedUsers(
        await request(app())
          .get("/api/v1/users")
          .query({ roleId: roleB.id })
          .set("Authorization", `Bearer ${admin.accessToken}`),
      );
      expect(listRes.items.some((row) => row.id === userId)).toBe(true);

      const listByOldRole = asPaginatedUsers(
        await request(app())
          .get("/api/v1/users")
          .query({ roleId: roleA.id })
          .set("Authorization", `Bearer ${admin.accessToken}`),
      );
      expect(listByOldRole.items.some((row) => row.id === userId)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "GET /users/me/permissions returns the caller's own resolved permission set, and it's immediately fresh after a grant",
    async () => {
      const admin = await seedTenantWithAdmin("my-permissions-flow", ["users.user.read"]);

      const beforeRes = await request(app()).get("/api/v1/users/me/permissions").set("Authorization", `Bearer ${admin.accessToken}`);
      expect(beforeRes.status).toBe(200);
      expect(asMyPermissions(beforeRes).permissions).toEqual(["users.user.read"]);

      const role = await createRole({
        schemaName: admin.tenant.schemaName,
        companyId: admin.companyId,
        name: "extra-role",
        createdBy: admin.adminUserId,
      });
      await assignRoleToUser(admin.tenant.schemaName, admin.companyId, admin.adminUserId, role.id, admin.adminUserId);
      const permissionId = await findPermissionId(admin.tenant.schemaName, "admin.company.read");
      await grantPermissionToRole(admin.tenant.schemaName, admin.companyId, role.id, permissionId, admin.adminUserId);

      // Same access token - no re-login, no TTL wait.
      const afterRes = await request(app()).get("/api/v1/users/me/permissions").set("Authorization", `Bearer ${admin.accessToken}`);
      expect(afterRes.status).toBe(200);
      expect(asMyPermissions(afterRes).permissions).toEqual(expect.arrayContaining(["users.user.read", "admin.company.read"]));
    },
    TEST_TIMEOUT_MS,
  );
});
