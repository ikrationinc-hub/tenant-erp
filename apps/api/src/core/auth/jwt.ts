import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../common/errors/index.js";

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "7d";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

/**
 * Nothing sensitive (rule 3 of the auth task) - just enough to scope a
 * request. `exp`/`iat` are declared explicitly (not left to zod's default
 * key-stripping) because logout needs `exp` to size the denylist TTL.
 */
const accessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  tenant: z.string().uuid(),
  company_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
  roles: z.array(z.string()),
  jti: z.string().uuid(),
  exp: z.number(),
  iat: z.number(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
/** What a caller provides to sign a new access token - jti/exp/iat are set by signAccessToken/jose, never by the caller. */
export type AccessTokenPayload = Omit<AccessTokenClaims, "jti" | "exp" | "iat">;

const refreshTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  tenant: z.string().uuid(),
  jti: z.string().uuid(),
  exp: z.number(),
  iat: z.number(),
});
export type RefreshTokenClaims = z.infer<typeof refreshTokenClaimsSchema>;

export async function signAccessToken(
  claims: AccessTokenPayload,
): Promise<{ token: string; jti: string }> {
  const jti = randomUUID();
  const token = await new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(accessSecret);
  return { token, jti };
}

/**
 * `jti` is supplied by the caller, not generated here: it must equal the id
 * of the refresh_tokens row the caller is about to insert, so a later
 * /refresh call can look this exact token up by jti.
 */
export async function signRefreshToken(
  claims: Pick<RefreshTokenClaims, "sub" | "tenant">,
  jti: string,
): Promise<string> {
  return new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_TTL)
    .sign(refreshSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, accessSecret));
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }

  const parsed = accessTokenClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthorizedError("Invalid access token claims");
  }
  return parsed.data;
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, refreshSecret));
  } catch {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  const parsed = refreshTokenClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    throw new UnauthorizedError("Invalid refresh token claims");
  }
  return parsed.data;
}
