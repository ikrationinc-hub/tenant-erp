import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import { companies, invitations, users } from "../../database/tenant/schema.js";

export type UserRow = typeof users.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface InsertInvitedUserInput {
  companyId: string;
  email: string;
  mobile: string;
  name: string;
  createdBy: string;
}

export async function insertInvitedUser(tx: TenantTx, input: InsertInvitedUserInput): Promise<UserRow> {
  const [user] = await tx
    .insert(users)
    .values({
      companyId: input.companyId,
      email: input.email,
      mobile: input.mobile,
      name: input.name,
      status: "invited",
      createdBy: input.createdBy,
    })
    .returning();
  if (!user) {
    throw new Error("failed to insert invited user");
  }
  return user;
}

export interface InsertProvisionedUserInput {
  companyId: string;
  mobile: string;
  name: string;
  passwordHash: string;
  createdBy: string;
}

export async function insertProvisionedUser(
  tx: TenantTx,
  input: InsertProvisionedUserInput,
): Promise<UserRow> {
  const [user] = await tx
    .insert(users)
    .values({
      companyId: input.companyId,
      email: null,
      mobile: input.mobile,
      name: input.name,
      passwordHash: input.passwordHash,
      status: "active",
      mustChangePassword: true,
      createdBy: input.createdBy,
    })
    .returning();
  if (!user) {
    throw new Error("failed to insert provisioned user");
  }
  return user;
}

export async function findActiveUserByEmailOrMobile(
  tx: TenantTx,
  email: string,
  mobile: string,
): Promise<UserRow | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  if (user) {
    return user;
  }
  return findActiveUserByMobile(tx, mobile);
}

export async function findActiveUserByMobile(tx: TenantTx, mobile: string): Promise<UserRow | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.mobile, mobile), isNull(users.deletedAt)))
    .limit(1);
  return user;
}

export async function findUserByCompanyAndEmail(
  tx: TenantTx,
  companyId: string,
  email: string,
): Promise<UserRow | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.companyId, companyId), eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  return user;
}

export async function activateInvitedUser(
  tx: TenantTx,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await tx
    .update(users)
    .set({
      passwordHash,
      status: "active",
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function setUserPassword(
  tx: TenantTx,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await tx
    .update(users)
    .set({ passwordHash, mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export interface InsertInvitationInput {
  companyId: string;
  email: string;
  tokenHash: string;
  roles: string[];
  invitedBy: string;
  expiresAt: Date;
}

export async function insertInvitation(
  tx: TenantTx,
  input: InsertInvitationInput,
): Promise<InvitationRow> {
  const [invitation] = await tx
    .insert(invitations)
    .values({
      companyId: input.companyId,
      email: input.email,
      tokenHash: input.tokenHash,
      roles: input.roles,
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!invitation) {
    throw new Error("failed to insert invitation");
  }
  return invitation;
}

export async function findInvitationByTokenHash(
  tx: TenantTx,
  tokenHash: string,
): Promise<InvitationRow | undefined> {
  const [invitation] = await tx
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash))
    .limit(1);
  return invitation;
}

export async function findInvitationById(
  tx: TenantTx,
  companyId: string,
  id: string,
): Promise<InvitationRow | undefined> {
  const [invitation] = await tx
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.companyId, companyId)))
    .limit(1);
  return invitation;
}

export async function markInvitationAccepted(tx: TenantTx, id: string): Promise<void> {
  await tx
    .update(invitations)
    .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(invitations.id, id));
}

export async function markInvitationRevoked(tx: TenantTx, id: string): Promise<void> {
  await tx
    .update(invitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(invitations.id, id));
}

export interface RenewInvitationInput {
  tokenHash: string;
  expiresAt: Date;
}

export async function renewInvitation(
  tx: TenantTx,
  id: string,
  input: RenewInvitationInput,
): Promise<void> {
  await tx
    .update(invitations)
    .set({ tokenHash: input.tokenHash, expiresAt: input.expiresAt, updatedAt: new Date() })
    .where(eq(invitations.id, id));
}

export async function findCompanyName(tx: TenantTx, companyId: string): Promise<string | undefined> {
  const [company] = await tx
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return company?.name;
}
