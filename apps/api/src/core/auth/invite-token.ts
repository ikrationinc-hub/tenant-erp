import { createHash, randomBytes } from "node:crypto";

export const INVITE_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Unlike refresh tokens (a jose-signed JWT, forging one requires the
 * signing secret - see docs/adr/0004-authentication.md), an invitation
 * token is a bare high-entropy random value: only its SHA-256 hash is ever
 * persisted (invitations.token_hash), so a DB read alone - a leaked
 * snapshot, a compromised replica - is never enough to redeem an
 * invitation. SHA-256 (not argon2) is deliberate: this hashes a 256-bit
 * random value, not a human-chosen secret, so there is no brute-force
 * search space slow hashing needs to defend against - a fast hash used
 * purely as a lookup key is the right tool, and using argon2 here would
 * only make every invitation validation needlessly expensive.
 */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
