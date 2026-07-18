import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/index.js";

const ACCESS_TOKEN_TTL = "8h";

/**
 * Signed with PLATFORM_JWT_SECRET, never JWT_ACCESS_SECRET - a platform
 * admin token must not verify against tenant auth, or vice versa
 * ("separate auth entirely", docs/Hyperion-ERP-Backend-Plan-v2.md). No
 * tenant/company/branch claims at all: a platform admin isn't scoped to
 * any tenant. No refresh rotation (unlike core/auth/jwt.ts) - platform
 * admin sessions are rare, manual, human-initiated actions, not the kind
 * of long-lived session that benefits from rotation; an 8h token that
 * expires is simpler and sufficient for this prototype's scope.
 */
const platformSecret = new TextEncoder().encode(env.PLATFORM_JWT_SECRET);

const platformAdminClaimsSchema = z.object({
  sub: z.string().uuid(),
  exp: z.number(),
  iat: z.number(),
});
export type PlatformAdminClaims = z.infer<typeof platformAdminClaimsSchema>;

export async function signPlatformAdminToken(platformAdminId: string): Promise<string> {
  return new SignJWT({ sub: platformAdminId })
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
