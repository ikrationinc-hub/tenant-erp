import { randomUUID } from "node:crypto";
import { UnauthorizedError } from "../../common/errors/index.js";
import { denylistJti, isJtiDenylisted } from "../../core/auth/denylist.js";
import { verifyPassword } from "../../core/auth/password.js";
import {
  clearLoginFailures,
  isLockedOut,
  recordLoginFailure,
} from "../../core/platform-auth/login-rate-limit.js";
import {
  PLATFORM_REFRESH_TOKEN_TTL_MS,
  signPlatformAdminToken,
  signPlatformRefreshToken,
  verifyPlatformRefreshToken,
} from "../../core/platform-auth/jwt.js";
import {
  findPlatformAdminByEmail,
  findPlatformAdminById,
  findPlatformRefreshTokenById,
  insertPlatformLoginHistory,
  insertPlatformRefreshToken,
  markPlatformRefreshTokenRotated,
  revokePlatformRefreshTokenFamily,
  type PlatformAdminRow,
} from "./platform.repository.js";

export interface PlatformLoginInput {
  email: string;
  password: string;
}

export interface PlatformRequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface PlatformAuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PlatformAdminSummary {
  id: string;
  email: string;
  name: string;
  status: PlatformAdminRow["status"];
}

/**
 * ALWAYS the same message - unknown-email, wrong-password, and locked-out
 * all throw this, so the response body is indistinguishable (mirrors
 * modules/auth/auth.service.ts's invalidCredentialsError).
 */
function invalidCredentialsError(): UnauthorizedError {
  return new UnauthorizedError("Invalid email or password");
}

async function issueTokenPair(admin: PlatformAdminRow): Promise<PlatformAuthTokens> {
  const familyId = randomUUID();
  const refreshId = randomUUID();

  const refreshToken = await signPlatformRefreshToken(admin.id, refreshId);
  await insertPlatformRefreshToken({
    id: refreshId,
    platformAdminId: admin.id,
    familyId,
    expiresAt: new Date(Date.now() + PLATFORM_REFRESH_TOKEN_TTL_MS),
  });

  const accessToken = await signPlatformAdminToken(admin.id);
  return { accessToken, refreshToken };
}

export async function platformAdminLogin(
  input: PlatformLoginInput,
  meta: PlatformRequestMeta,
): Promise<PlatformAuthTokens & { admin: PlatformAdminSummary }> {
  if (await isLockedOut(input.email)) {
    throw new UnauthorizedError("Too many failed attempts. Try again later.");
  }

  const admin = await findPlatformAdminByEmail(input.email);
  const passwordOk = await verifyPassword(admin?.passwordHash ?? null, input.password);

  if (!admin || !passwordOk) {
    await recordLoginFailure(input.email);
    await insertPlatformLoginHistory({
      ...(admin ? { platformAdminId: admin.id } : {}),
      attemptedEmail: input.email,
      outcome: "failure",
      reason: admin ? "invalid_password" : "unknown_email",
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });
    throw invalidCredentialsError();
  }

  if (admin.status !== "active") {
    await insertPlatformLoginHistory({
      platformAdminId: admin.id,
      attemptedEmail: input.email,
      outcome: "failure",
      reason: `account_${admin.status}`,
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
    });
    throw new UnauthorizedError("Account is suspended");
  }

  await clearLoginFailures(input.email);

  const tokens = await issueTokenPair(admin);

  await insertPlatformLoginHistory({
    platformAdminId: admin.id,
    attemptedEmail: input.email,
    outcome: "success",
    ...(meta.ip ? { ip: meta.ip } : {}),
    ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
  });

  return {
    ...tokens,
    admin: { id: admin.id, email: admin.email, name: admin.name, status: admin.status },
  };
}

export async function platformAdminRefresh(refreshTokenString: string): Promise<PlatformAuthTokens> {
  const claims = await verifyPlatformRefreshToken(refreshTokenString);

  const existing = await findPlatformRefreshTokenById(claims.jti);
  if (!existing) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (existing.revokedAt !== null) {
    // Reuse: this token was already rotated away (or revoked) and is being
    // presented again - revoke the whole rotation lineage, mirroring
    // modules/auth/auth.service.ts's refresh().
    await revokePlatformRefreshTokenFamily(existing.familyId);
    throw new UnauthorizedError("Refresh token reuse detected");
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("Refresh token expired");
  }

  const admin = await findPlatformAdminById(existing.platformAdminId);
  if (!admin || admin.status !== "active") {
    throw new UnauthorizedError("Account is not active");
  }

  const newRefreshId = randomUUID();
  const newRefreshToken = await signPlatformRefreshToken(admin.id, newRefreshId);
  await insertPlatformRefreshToken({
    id: newRefreshId,
    platformAdminId: admin.id,
    familyId: existing.familyId,
    expiresAt: new Date(Date.now() + PLATFORM_REFRESH_TOKEN_TTL_MS),
  });
  await markPlatformRefreshTokenRotated(existing.id, newRefreshId);

  const accessToken = await signPlatformAdminToken(admin.id);
  return { accessToken, refreshToken: newRefreshToken };
}

export async function platformAdminLogout(refreshTokenString: string, accessTokenJti: string, accessTokenExp: number): Promise<void> {
  const claims = await verifyPlatformRefreshToken(refreshTokenString);

  const existing = await findPlatformRefreshTokenById(claims.jti);
  if (existing) {
    await revokePlatformRefreshTokenFamily(existing.familyId);
  }

  const remainingSeconds = Math.max(0, accessTokenExp - Math.floor(Date.now() / 1000));
  await denylistJti(accessTokenJti, remainingSeconds);
}

export async function isPlatformAccessTokenDenylisted(jti: string): Promise<boolean> {
  return isJtiDenylisted(jti);
}

export async function platformAdminMe(platformAdminId: string): Promise<PlatformAdminSummary> {
  const admin = await findPlatformAdminById(platformAdminId);
  if (!admin) {
    throw new UnauthorizedError("Platform admin not found");
  }
  return { id: admin.id, email: admin.email, name: admin.name, status: admin.status };
}
