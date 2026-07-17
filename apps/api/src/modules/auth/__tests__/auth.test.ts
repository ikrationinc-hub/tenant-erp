import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../../app.js";
import { closeDbPool } from "../../../config/db.js";
import { env } from "../../../config/env.js";
import { closeRedis } from "../../../config/redis.js";
import { hashPassword } from "../../../core/auth/password.js";
import { createTenantSchema, type ProvisionedTenant } from "../../../core/tenant/provisioner.js";
import { closeTenantDbPool, withTenantSchema } from "../../../database/get-db.js";
import { companies, users } from "../../../database/tenant/schema.js";

const TEST_TIMEOUT_MS = 120_000;
const KNOWN_PASSWORD = "correct-horse-battery-staple";

const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const loginResponseSchema = authTokensSchema.extend({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    companyId: z.string(),
  }),
});

const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  companyId: z.string(),
  status: z.string(),
});

const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

function asLogin(res: { body: unknown }) {
  return loginResponseSchema.parse(res.body);
}
function asTokens(res: { body: unknown }) {
  return authTokensSchema.parse(res.body);
}
function asMe(res: { body: unknown }) {
  return meResponseSchema.parse(res.body);
}
function asError(res: { body: unknown }) {
  return errorResponseSchema.parse(res.body);
}

interface SeededTenant {
  tenant: ProvisionedTenant;
  companyId: string;
  userId: string;
  email: string;
}

async function seedTenantWithActiveUser(label: string): Promise<SeededTenant> {
  const unique = randomUUID().slice(0, 8);
  const tenant = await createTenantSchema({ name: `${label} Co`, slug: `${label}-${unique}` });
  const email = `${label}-${unique}@example.com`;
  const passwordHash = await hashPassword(KNOWN_PASSWORD);

  const { companyId, userId } = await withTenantSchema(tenant.schemaName, async (tx) => {
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
      .values({
        companyId: company.id,
        email,
        mobile: "+10000000000",
        passwordHash,
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

  return { tenant, companyId, userId, email };
}

function app() {
  return createApp();
}

describe("auth: login/refresh/logout/me", () => {
  afterAll(async () => {
    await closeTenantDbPool();
    await closeDbPool();
    await closeRedis();
  });

  it(
    "happy path: login, /me, refresh all work end to end",
    async () => {
      const seed = await seedTenantWithActiveUser("happy");

      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: KNOWN_PASSWORD, tenantCode: seed.tenant.slug });

      expect(loginRes.status).toBe(200);
      const login = asLogin(loginRes);
      expect(login.user).toMatchObject({ id: seed.userId, email: seed.email, companyId: seed.companyId });

      const meRes = await request(app())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.accessToken}`);
      expect(meRes.status).toBe(200);
      expect(asMe(meRes)).toMatchObject({ id: seed.userId, email: seed.email });

      const refreshRes = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });
      expect(refreshRes.status).toBe(200);
      asTokens(refreshRes);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "wrong password is rejected",
    async () => {
      const seed = await seedTenantWithActiveUser("wrongpw");

      const res = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: "not-the-password", tenantCode: seed.tenant.slug });

      expect(res.status).toBe(401);
      expect(asError(res).error.message).toBe("Invalid email or password");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "unknown email produces an identical response to wrong password",
    async () => {
      const seed = await seedTenantWithActiveUser("unknown");

      const wrongPasswordRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: "not-the-password", tenantCode: seed.tenant.slug });

      const unknownEmailRes = await request(app())
        .post("/api/v1/auth/login")
        .send({
          identifier: `does-not-exist-${randomUUID()}@example.com`,
          password: "whatever",
          tenantCode: seed.tenant.slug,
        });

      expect(unknownEmailRes.status).toBe(wrongPasswordRes.status);
      const wrongPasswordError = asError(wrongPasswordRes).error;
      const unknownEmailError = asError(unknownEmailRes).error;
      expect(unknownEmailError.code).toBe(wrongPasswordError.code);
      expect(unknownEmailError.message).toBe(wrongPasswordError.message);
      expect(unknownEmailError.details).toBeUndefined();
      expect(wrongPasswordError.details).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "no meaningful timing difference between unknown-email and wrong-password",
    async () => {
      const ROUNDS = 12;
      const seed = await seedTenantWithActiveUser("timing");

      // A distinct real user per round: the per-email lockout (5 failures)
      // would otherwise kick in after round 5 and short-circuit the
      // remaining wrong-password attempts, making them artificially fast
      // and contaminating the very comparison this test makes.
      const wrongPasswordEmails = await withTenantSchema(seed.tenant.schemaName, async (tx) => {
        const emails: string[] = [];
        for (let i = 0; i < ROUNDS; i += 1) {
          const email = `timing-wrongpw-${i}-${randomUUID()}@example.com`;
          await tx.insert(users).values({
            companyId: seed.companyId,
            email,
            mobile: `+1555${String(i).padStart(7, "0")}`,
            passwordHash: await hashPassword(KNOWN_PASSWORD),
            name: `Timing User ${i}`,
            status: "active",
            createdBy: randomUUID(),
          });
          emails.push(email);
        }
        return emails;
      });

      async function timeAttempt(email: string, password: string): Promise<number> {
        const start = performance.now();
        await request(app())
          .post("/api/v1/auth/login")
          .send({ identifier: email, password, tenantCode: seed.tenant.slug });
        return performance.now() - start;
      }

      const wrongPasswordTimes: number[] = [];
      const unknownEmailTimes: number[] = [];

      for (const [i, wrongPasswordEmail] of wrongPasswordEmails.entries()) {
        // Interleaved so neither group is systematically favoured by warmup/GC jitter.
        wrongPasswordTimes.push(await timeAttempt(wrongPasswordEmail, `wrong-${i}`));
        unknownEmailTimes.push(await timeAttempt(`no-such-user-${i}-${randomUUID()}@example.com`, `pw-${i}`));
      }

      const average = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
      const wrongPasswordAvg = average(wrongPasswordTimes);
      const unknownEmailAvg = average(unknownEmailTimes);
      const relativeDifference =
        Math.abs(wrongPasswordAvg - unknownEmailAvg) / Math.max(wrongPasswordAvg, unknownEmailAvg);

      // Generous bound: argon2id hashing dominates total time in both branches
      // (tens of ms), so a real skip-the-hash bug would show up as multiples,
      // not a percentage - this just needs to rule out gross asymmetry, not
      // detect single-digit-millisecond noise.
      expect(relativeDifference).toBeLessThan(0.35);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refresh rotation: each /refresh call returns a fresh token pair",
    async () => {
      const seed = await seedTenantWithActiveUser("rotation");
      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: KNOWN_PASSWORD, tenantCode: seed.tenant.slug });
      const login = asLogin(loginRes);

      const firstRefreshRes = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });

      expect(firstRefreshRes.status).toBe(200);
      const firstRefresh = asTokens(firstRefreshRes);
      expect(firstRefresh.refreshToken).not.toBe(login.refreshToken);
      expect(firstRefresh.accessToken).not.toBe(login.accessToken);

      const secondRefreshRes = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: firstRefresh.refreshToken });

      expect(secondRefreshRes.status).toBe(200);
      expect(asTokens(secondRefreshRes).refreshToken).not.toBe(firstRefresh.refreshToken);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refresh reuse revokes the whole family, including the legitimate successor",
    async () => {
      const seed = await seedTenantWithActiveUser("reuse");
      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: KNOWN_PASSWORD, tenantCode: seed.tenant.slug });
      const login = asLogin(loginRes);

      const firstRefreshRes = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });
      expect(firstRefreshRes.status).toBe(200);
      const firstRefresh = asTokens(firstRefreshRes);

      // Reuse the ORIGINAL (already-rotated-away) refresh token.
      const reuseAttempt = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });
      expect(reuseAttempt.status).toBe(401);

      // The token issued by the legitimate first refresh must be dead too -
      // reuse revokes the whole family, not just the replayed token.
      const legitimateSuccessorAttempt = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: firstRefresh.refreshToken });
      expect(legitimateSuccessorAttempt.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an expired access token is rejected",
    async () => {
      const seed = await seedTenantWithActiveUser("expired");
      const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
      const expiredToken = await new SignJWT({
        sub: seed.userId,
        tenant: seed.tenant.id,
        company_id: seed.companyId,
        roles: [],
        jti: randomUUID(),
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(secret);

      const res = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a logged-out access token is rejected",
    async () => {
      const seed = await seedTenantWithActiveUser("logout");
      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: KNOWN_PASSWORD, tenantCode: seed.tenant.slug });
      const login = asLogin(loginRes);

      const meBefore = await request(app())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.accessToken}`);
      expect(meBefore.status).toBe(200);

      const logoutRes = await request(app())
        .post("/api/v1/auth/logout")
        .set("Authorization", `Bearer ${login.accessToken}`)
        .send({ refreshToken: login.refreshToken });
      expect(logoutRes.status).toBe(204);

      const meAfter = await request(app())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.accessToken}`);
      expect(meAfter.status).toBe(401);

      const refreshAfterLogout = await request(app())
        .post("/api/v1/auth/refresh")
        .send({ refreshToken: login.refreshToken });
      expect(refreshAfterLogout.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a user from tenant A cannot use their token against tenant B, even with a colliding user id",
    async () => {
      const tenantA = await seedTenantWithActiveUser("cross-a");

      // Deliberately force a colliding primary key across schemas: insert a
      // tenant B user with the EXACT SAME id as tenant A's user. If scope
      // resolution or the repository ever fell back to a global (schema-
      // unaware) lookup, this is what would leak tenant B's data through
      // tenant A's token.
      const tenantB = await createTenantSchema({ name: "Cross B Co", slug: `cross-b-${randomUUID().slice(0, 8)}` });
      await withTenantSchema(tenantB.schemaName, async (tx) => {
        const [companyB] = await tx
          .insert(companies)
          .values({
            name: "Cross B Co",
            countryCode: "GB",
            currencyCode: "GBP",
            fiscalYearStartMonth: 4,
            timezone: "Europe/London",
            createdBy: randomUUID(),
          })
          .returning();
        if (!companyB) {
          throw new Error("failed to insert company B");
        }
        await tx.insert(users).values({
          id: tenantA.userId, // <- the collision
          companyId: companyB.id,
          email: `tenant-b-${randomUUID()}@example.com`,
          mobile: "+19999999999",
          passwordHash: await hashPassword("irrelevant"),
          name: "Tenant B Impersonator",
          status: "active",
          createdBy: randomUUID(),
        });
      });

      const loginRes = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: tenantA.email, password: KNOWN_PASSWORD, tenantCode: tenantA.tenant.slug });
      expect(loginRes.status).toBe(200);
      const login = asLogin(loginRes);

      const meRes = await request(app())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${login.accessToken}`);

      expect(meRes.status).toBe(200);
      const me = asMe(meRes);
      expect(me.id).toBe(tenantA.userId);
      expect(me.email).toBe(tenantA.email);
      expect(me.companyId).toBe(tenantA.companyId);
      expect(me.name).not.toBe("Tenant B Impersonator");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "resolves the tenant from the subdomain when no tenantCode is given",
    async () => {
      const seed = await seedTenantWithActiveUser("subdomain");

      const res = await request(app())
        .post("/api/v1/auth/login")
        .set("Host", `${seed.tenant.slug}.hyperion-erp.example.com`)
        .send({ identifier: seed.email, password: KNOWN_PASSWORD });

      expect(res.status).toBe(200);
      expect(asLogin(res).user.id).toBe(seed.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "locks out after repeated failures, identically for a real and a fake email",
    async () => {
      const seed = await seedTenantWithActiveUser("lockout");
      const fakeEmail = `fake-${randomUUID()}@example.com`;

      for (let i = 0; i < 5; i += 1) {
        await request(app())
          .post("/api/v1/auth/login")
          .send({ identifier: seed.email, password: "wrong", tenantCode: seed.tenant.slug });
        await request(app())
          .post("/api/v1/auth/login")
          .send({ identifier: fakeEmail, password: "wrong", tenantCode: seed.tenant.slug });
      }

      const realEmailLockedOut = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: seed.email, password: KNOWN_PASSWORD, tenantCode: seed.tenant.slug });
      const fakeEmailLockedOut = await request(app())
        .post("/api/v1/auth/login")
        .send({ identifier: fakeEmail, password: "wrong", tenantCode: seed.tenant.slug });

      expect(realEmailLockedOut.status).toBe(401);
      expect(fakeEmailLockedOut.status).toBe(401);
      expect(asError(realEmailLockedOut).error.message).toBe(asError(fakeEmailLockedOut).error.message);
    },
    TEST_TIMEOUT_MS,
  );
});
