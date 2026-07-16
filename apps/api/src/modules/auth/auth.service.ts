import { randomUUID } from "node:crypto";
import { UnauthorizedError } from "../../common/errors/index.js";
import type { RequestContext } from "../../common/context/request-context.js";
import { denylistJti } from "../../core/auth/denylist.js";
import { REFRESH_TOKEN_TTL_MS, signAccessToken, signRefreshToken, verifyRefreshToken } from "../../core/auth/jwt.js";
import { clearLoginFailures, isLockedOut, recordLoginFailure } from "../../core/auth/login-rate-limit.js";
import { verifyPassword } from "../../core/auth/password.js";
import { getActiveTenantById, resolveTenantForLogin } from "../../core/auth/tenant-resolver.js";
import { withTenantDb, withTenantSchema, type TenantTx } from "../../database/get-db.js";
import { logger } from "../../config/logger.js";
import {
  findRefreshTokenById,
  findUserByEmail,
  findUserById,
  insertLoginHistory,
  insertRefreshToken,
  markRefreshTokenRotated,
  revokeFamily,
  touchLastLogin,
  type UserRow,
} from "./auth.repository.js";
import type { LoginInput } from "./auth.validator.js";

export interface RequestMeta {
  hostname: string;
  ip?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResult extends AuthTokens {
  user: {
    id: string;
    email: string;
    name: string;
    companyId: string;
  };
}

export interface MeResult {
  id: string;
  email: string;
  name: string;
  companyId: string;
  status: UserRow["status"];
}

/**
 * ALWAYS the same message, ALWAYS with no `details` - the one and only error
 * unknown-email and wrong-password may ever produce, so the response bodies
 * (and, since neither branch does extra work before throwing it, the
 * timing) are indistinguishable. An unresolved tenant uses this too: "no
 * such tenant" must not read differently than "no such user".
 */
function invalidCredentialsError(): UnauthorizedError {
  return new UnauthorizedError("Invalid email or password");
}

async function issueTokenPair(
  tenantId: string,
  user: Pick<UserRow, "id" | "companyId">,
  tx: TenantTx,
): Promise<AuthTokens> {
  const familyId = randomUUID();
  const refreshId = randomUUID();

  const refreshToken = await signRefreshToken({ sub: user.id, tenant: tenantId }, refreshId);
  await insertRefreshToken(tx, {
    id: refreshId,
    userId: user.id,
    companyId: user.companyId,
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  const { token: accessToken } = await signAccessToken({
    sub: user.id,
    tenant: tenantId,
    company_id: user.companyId,
    roles: [],
  });

  return { accessToken, refreshToken };
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
  const tenant = await resolveTenantForLogin(meta.hostname, input.tenantCode);

  if (!tenant) {
    logger.warn({ email: input.email, hostname: meta.hostname }, "login against unresolved tenant");
    throw invalidCredentialsError();
  }

  if (await isLockedOut(tenant.schemaName, input.email)) {
    throw new UnauthorizedError("Too many failed attempts. Try again later.");
  }

  return withTenantSchema(tenant.schemaName, async (tx) => {
    const user = await findUserByEmail(tx, input.email);
    const passwordOk = await verifyPassword(user?.passwordHash ?? null, input.password);

    if (!user || !passwordOk) {
      await recordLoginFailure(tenant.schemaName, input.email);
      await insertLoginHistory(tx, {
        ...(user ? { userId: user.id, companyId: user.companyId } : {}),
        attemptedEmail: input.email,
        outcome: "failure",
        reason: user ? "invalid_password" : "unknown_email",
        ...(meta.ip ? { ip: meta.ip } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      });
      throw invalidCredentialsError();
    }

    if (user.status !== "active") {
      await insertLoginHistory(tx, {
        userId: user.id,
        companyId: user.companyId,
        attemptedEmail: input.email,
        outcome: "failure",
        reason: `account_${user.status}`,
        ...(meta.ip ? { ip: meta.ip } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      });
      throw new UnauthorizedError(
        user.status === "invited" ? "Account has not been activated yet" : "Account is suspended",
      );
    }

    await clearLoginFailures(tenant.schemaName, input.email);
    await touchLastLogin(tx, user.id);

    const tokens = await issueTokenPair(tenant.id, user, tx);

    await insertLoginHistory(tx, {
      userId: user.id,
      companyId: user.companyId,
      attemptedEmail: input.email,
      outcome: "success",
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });

    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name, companyId: user.companyId },
    };
  });
}

export async function refresh(refreshTokenString: string): Promise<AuthTokens> {
  const claims = await verifyRefreshToken(refreshTokenString);

  const tenant = await getActiveTenantById(claims.tenant);
  if (!tenant) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  // Deliberately its own transaction, separate from the rotation below: if
  // reuse is detected, revokeFamily must actually commit before we throw -
  // throwing from inside the SAME transaction as the revocation would roll
  // the revocation back too (drizzle's .transaction() rolls back on any
  // throw from its callback), silently undoing the one thing reuse
  // detection exists to guarantee.
  const existing = await withTenantSchema(tenant.schemaName, (tx) => findRefreshTokenById(tx, claims.jti));

  if (!existing) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (existing.revokedAt !== null) {
    // Reuse: this token was already rotated away (or revoked) and is being
    // presented again - the whole rotation lineage is compromised, not
    // just this one token.
    await withTenantSchema(tenant.schemaName, (tx) => revokeFamily(tx, existing.familyId));
    logger.warn(
      { tenant: tenant.id, familyId: existing.familyId },
      "refresh token reuse detected - family revoked",
    );
    throw new UnauthorizedError("Refresh token reuse detected");
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Refresh token expired");
  }

  return withTenantSchema(tenant.schemaName, async (tx) => {
    const user = await findUserById(tx, existing.userId);
    if (!user || user.status !== "active") {
      throw new UnauthorizedError("Account is not active");
    }

    const newRefreshId = randomUUID();
    const newRefreshToken = await signRefreshToken({ sub: user.id, tenant: tenant.id }, newRefreshId);
    await insertRefreshToken(tx, {
      id: newRefreshId,
      userId: user.id,
      companyId: existing.companyId,
      familyId: existing.familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    await markRefreshTokenRotated(tx, existing.id, newRefreshId);

    const { token: accessToken } = await signAccessToken({
      sub: user.id,
      tenant: tenant.id,
      company_id: user.companyId,
      roles: [],
    });

    return { accessToken, refreshToken: newRefreshToken };
  });
}

export async function logout(ctx: RequestContext, refreshTokenString: string): Promise<void> {
  if (!ctx.tenantScope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  const { tenantId, userId } = ctx.tenantScope;

  const refreshClaims = await verifyRefreshToken(refreshTokenString);
  if (refreshClaims.tenant !== tenantId || refreshClaims.sub !== userId) {
    throw new UnauthorizedError("Refresh token does not match the authenticated session");
  }

  await withTenantDb(ctx, async (tx) => {
    const existing = await findRefreshTokenById(tx, refreshClaims.jti);
    if (existing) {
      await revokeFamily(tx, existing.familyId);
    }
  });
}

export async function denylistCurrentAccessToken(jti: string, expiresAtSeconds: number): Promise<void> {
  const remainingSeconds = Math.max(0, expiresAtSeconds - Math.floor(Date.now() / 1000));
  await denylistJti(jti, remainingSeconds);
}

export async function me(ctx: RequestContext): Promise<MeResult> {
  const userId = ctx.tenantScope?.userId;
  if (!userId) {
    throw new UnauthorizedError("Missing bearer token");
  }

  return withTenantDb(ctx, async (tx) => {
    const user = await findUserById(tx, userId);
    if (!user) {
      throw new UnauthorizedError("User not found");
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      companyId: user.companyId,
      status: user.status,
    };
  });
}
