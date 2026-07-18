import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/index.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
export const PLATFORM_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Signed with PLATFORM_JWT_SECRET, never JWT_ACCESS_SECRET/JWT_REFRESH_SECRET -
 * a platform admin token must not verify against tenant auth, or vice versa
 * ("separate auth entirely", docs/Hyperion-ERP-Backend-Plan-v2.md). This is
 * the actual security boundary: cross-audience use fails at signature
 * verification (wrong secret), not at a claim check that could be skipped by
 * accident. No tenant/company/branch claims at all: a platform admin isn't
 * scoped to any tenant.
 */
const platformSecret = new TextEncoder().encode(env.PLATFORM_JWT_SECRET);

const platformAdminClaimsSchema = z.object({
  sub: z.string().uuid(),
  jti: z.string().uuid(),
  exp: z.number(),
  iat: z.number(),
});
export type PlatformAdminClaims = z.infer<typeof platformAdminClaimsSchema>;

const platformRefreshClaimsSchema = z.object({
  sub: z.string().uuid(),
  jti: z.string().uuid(),
  exp: z.number(),
  iat: z.number(),
});
export type PlatformRefreshClaims = z.infer<typeof platformRefreshClaimsSchema>;

export async function signPlatformAdminToken(platformAdminId: string): Promise<string> {
  return new SignJWT({ sub: platformAdminId, jti: randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(platformSecret);
}

export async function verifyPlatformAdminToken(token: string): Promise<PlatformAdminClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, platformSecret));
  } catch {
    throw new UnauthorizedError("Invalid or expired platform admin token");
  }

  const parsed = platformAdminClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthorizedError("Invalid platform admin token claims");
  }
  return parsed.data;
}

/**
 * `jti` is supplied by the caller, not generated here: it must equal the id
 * of the platform_refresh_tokens row the caller is about to insert, so a
 * later /refresh call can look this exact token up by jti (mirrors
 * core/auth/jwt.ts's signRefreshToken).
 */
export async function signPlatformRefreshToken(platformAdminId: string, jti: string): Promise<string> {
  return new SignJWT({ sub: platformAdminId, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(platformSecret);
}

export async function verifyPlatformRefreshToken(token: string): Promise<PlatformRefreshClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, platformSecret));
  } catch {
    throw new UnauthorizedError("Invalid or expired platform refresh token");
  }

  const parsed = platformRefreshClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthorizedError("Invalid platform refresh token claims");
  }
  return parsed.data;
}
