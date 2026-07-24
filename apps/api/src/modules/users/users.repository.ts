import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { TenantTx } from "../../database/get-db.js";
import type { PaginatedRows } from "../../core/masters/types.js";
import { companies, invitations, userRoles, users } from "../../database/tenant/schema.js";

export type UserRow = typeof users.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;

export interface UsersListParams {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: "invited" | "active" | "suspended" | undefined;
  roleId?: string | undefined;
}

/** The row shape FE-5.5's UserManagementScreen renders directly (packages/contracts/src/users-admin.ts's doc comment, task item 5). */
export interface UserListRow {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  status: string;
  lastLoginAt: Date | null;
  roleIds: string[];
  invitationId: string | null;
  invitationExpiresAt: Date | null;
}

/**
 * Three plain queries rather than one grouped join (task item 5): a
 * user-to-roles join is one-to-many and a user-to-pending-invitation join
 * is one-to-zero-or-one, so combining both in a single SQL join would
 * either cartesian-multiply the role rows or need a json_agg subquery -
 * doable, but three typed queries over a page-sized (<=200) row set costs
 * nothing extra here and keeps every step in drizzle's normal query
 * builder instead of a hand-written aggregate (core/rbac/resolve.ts's raw
 * SQL is justified there by being on the hot per-request permission-check
 * path; this is an admin list screen).
 */
export async function listUsers(tx: TenantTx, companyId: string, params: UsersListParams): Promise<PaginatedRows<UserListRow>> {
  const conditions = [eq(users.companyId, companyId), isNull(users.deletedAt)];
  if (params.status) {
    conditions.push(eq(users.status, params.status));
  }
  if (params.search) {
    const term = `%${params.search}%`;
    const searchCondition = or(ilike(users.name, term), ilike(users.email, term), ilike(users.mobile, term));
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }
  if (params.roleId) {
    const roleUserRows = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(and(eq(userRoles.roleId, params.roleId), isNull(userRoles.deletedAt)));
    const roleUserIds = roleUserRows.map((row) => row.userId);
    if (roleUserIds.length === 0) {
      return { items: [], total: 0, page: params.page, pageSize: params.pageSize };
    }
    conditions.push(inArray(users.id, roleUserIds));
  }

  const where = and(...conditions);
  const offset = (params.page - 1) * params.pageSize;

  const [rows, totalRows] = await Promise.all([
    tx
      .select()
      .from(users)
      .where(where)
      .orderBy(asc(users.name))
      .limit(params.pageSize)
      .offset(offset),
    tx.select({ value: sql<number>`count(*)::int` }).from(users).where(where),
  ]);

  const userIds = rows.map((row) => row.id);
  const emails = rows.map((row) => row.email).filter((email): email is string => email !== null);

  const [roleRows, pendingInvitations] = await Promise.all([
    userIds.length > 0
      ? tx
          .select({ userId: userRoles.userId, roleId: userRoles.roleId })
          .from(userRoles)
          .where(and(inArray(userRoles.userId, userIds), isNull(userRoles.deletedAt)))
      : Promise.resolve([]),
    emails.length > 0
      ? tx
          .select({ id: invitations.id, email: invitations.email, expiresAt: invitations.expiresAt })
          .from(invitations)
          .where(and(eq(invitations.companyId, companyId), eq(invitations.status, "pending"), inArray(invitations.email, emails)))
      : Promise.resolve([]),
  ]);

  const roleIdsByUserId = new Map<string, string[]>();
  for (const row of roleRows) {
    const existing = roleIdsByUserId.get(row.userId) ?? [];
    existing.push(row.roleId);
    roleIdsByUserId.set(row.userId, existing);
  }
  const invitationByEmail = new Map(pendingInvitations.map((invitation) => [invitation.email, invitation]));

  const items: UserListRow[] = rows.map((row) => {
    const invitation = row.email ? invitationByEmail.get(row.email) : undefined;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      mobile: row.mobile,
      status: row.status,
      lastLoginAt: row.lastLoginAt,
      roleIds: roleIdsByUserId.get(row.id) ?? [],
      invitationId: invitation?.id ?? null,
      invitationExpiresAt: invitation?.expiresAt ?? null,
    };
  });

  return {
    items,
    total: totalRows[0]?.value ?? 0,
    page: params.page,
    pageSize: params.pageSize,
  };
}

export async function findUserByIdInCompany(tx: TenantTx, companyId: string, id: string): Promise<UserRow | undefined> {
  const [row] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.companyId, companyId), isNull(users.deletedAt)))
    .limit(1);
  return row;
}

export async function setUserStatus(
  tx: TenantTx,
  id: string,
  status: "invited" | "active" | "suspended",
): Promise<UserRow | undefined> {
  const [row] = await tx
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning();
  return row;
}

/** Only the repository layer touches SQL (rule 5) - service/controller never import `db`. */

export interface InsertInvitedUserInput {
  companyId: string;
  email: string;
  /** Optional: the regular /users/invite flow always collects it, but core/provisioning/provision-tenant.ts inviting a tenant admin has only a name and email to work with (see schema.ts's doc comment on users.mobile). */
  mobile?: string;
  name: string;
  createdBy: string;
}

export async function insertInvitedUser(tx: TenantTx, input: InsertInvitedUserInput): Promise<UserRow> {
  const [user] = await tx
    .insert(users)
    .values({
      companyId: input.companyId,
      email: input.email,
      name: input.name,
      status: "invited",
      createdBy: input.createdBy,
      ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
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

/** Tenant-wide (not company-scoped) - core/provisioning/provision-tenant.ts checks this before creating a tenant's first admin, before any company-specific lookup makes sense. */
export async function findActiveUserByEmail(tx: TenantTx, email: string): Promise<UserRow | undefined> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
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
