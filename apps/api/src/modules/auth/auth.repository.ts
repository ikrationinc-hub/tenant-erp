import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { loginHistory, refreshTokens, users } from "../../database/tenant/schema.js";

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export async function findUserByEmail(tx: TenantTx, email: string): Promise<UserRow | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return user;
}

export async function findUserById(tx: TenantTx, id: string): Promise<UserRow | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return user;
}

export async function touchLastLogin(tx: TenantTx, userId: string): Promise<void> {
  await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

export interface InsertRefreshTokenInput {
  id: string;
  userId: string;
  companyId: string;
  familyId: string;
  expiresAt: Date;
}

export async function insertRefreshToken(tx: TenantTx, input: InsertRefreshTokenInput): Promise<void> {
  await tx.insert(refreshTokens).values(input);
}

export async function findRefreshTokenById(
  tx: TenantTx,
  id: string,
): Promise<RefreshTokenRow | undefined> {
  const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, id)).limit(1);
  return row;
}

/** Rotation: this token is superseded by `replacedById`, never usable again. */
export async function markRefreshTokenRotated(
  tx: TenantTx,
  id: string,
  replacedById: string,
): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date(), replacedById, updatedAt: new Date() })
    .where(eq(refreshTokens.id, id));
}

/** Explicit revocation (logout) - no replacement token. */
export async function revokeRefreshToken(tx: TenantTx, id: string): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(refreshTokens.id, id));
}

/** Reuse detected, or an explicit logout: the whole rotation lineage is over, not just one token. */
export async function revokeFamily(tx: TenantTx, familyId: string): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

export interface InsertLoginHistoryInput {
  userId?: string;
  companyId?: string;
  attemptedEmail: string;
  outcome: "success" | "failure";
  reason?: string;
  ip?: string;
  userAgent?: string;
}

export async function insertLoginHistory(tx: TenantTx, input: InsertLoginHistoryInput): Promise<void> {
  await tx.insert(loginHistory).values(input);
}
