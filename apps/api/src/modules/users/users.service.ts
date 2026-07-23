import type { RequestContext } from "../../common/context/request-context.js";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { assertPasswordMeetsPolicy } from "../../core/auth/password-policy.js";
import { hashPassword } from "../../core/auth/password.js";
import { generateInviteToken, hashInviteToken, INVITE_TOKEN_TTL_MS } from "../../core/auth/invite-token.js";
import { getActiveTenantById, resolveTenantForLogin } from "../../core/auth/tenant-resolver.js";
import { insertAuditLog } from "../../core/audit/write.js";
import { getMailer } from "../../core/notification/mailer.js";
import { buildInviteEmail } from "../../core/notification/templates/invite-email.js";
import { assignRoleToUser } from "../../core/rbac/mutations.js";
import { roleIdsExist, roleIdsHoldApprovalPermission } from "../../core/rbac/queries.js";
import { withTenantDb, withTenantSchema, type TenantTx } from "../../database/get-db.js";
import { issueTokenPair, type AuthTokens } from "../auth/auth.service.js";
import type {
  AcceptInvitationInput,
  ChangePasswordInput,
  InviteUserInput,
  ProvisionUserInput,
} from "./users.validator.js";
import {
  activateInvitedUser,
  findActiveUserByEmailOrMobile,
  findActiveUserByMobile,
  findCompanyName,
  findInvitationById,
  findInvitationByTokenHash,
  findUserByCompanyAndEmail,
  insertInvitation,
  insertInvitedUser,
  insertProvisionedUser,
  markInvitationAccepted,
  markInvitationRevoked,
  renewInvitation,
  setUserPassword,
  type InvitationRow,
} from "./users.repository.js";

interface AuthenticatedScope {
  tenantId: string;
  tenantSchema: string;
  companyId: string;
  userId: string;
  branchId?: string;
  roles?: string[];
}

function requireTenantScope(ctx: RequestContext): AuthenticatedScope {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  // Rebuilt rather than returned as-is: narrowing `scope.userId` above only
  // narrows that one read, not the declared type of `scope` as a whole -
  // assigning it directly here is what makes userId a real `string` on the
  // object callers get back.
  return { ...scope, userId: scope.userId };
}

async function assertRolesExist(tx: TenantTx, companyId: string, roleIds: string[]): Promise<void> {
  const existing = await roleIdsExist(tx, companyId, roleIds);
  const missing = roleIds.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    throw new ConflictError("One or more roles do not exist for this company", { missing });
  }
}

function isInvitationUsable(invitation: InvitationRow): boolean {
  return invitation.status === "pending" && invitation.expiresAt.getTime() > Date.now();
}

export interface InviteUserResult {
  invitationId: string;
  userId: string;
}

export async function inviteUser(ctx: RequestContext, input: InviteUserInput): Promise<InviteUserResult> {
  const scope = requireTenantScope(ctx);
  const { companyId } = scope;

  const { invitation, userId, companyName } = await withTenantDb(ctx, async (tx) => {
    await assertRolesExist(tx, companyId, input.roles);

    const existing = await findActiveUserByEmailOrMobile(tx, input.email, input.mobile);
    if (existing) {
      throw new ConflictError("A user with this email or mobile already exists");
    }

    const user = await insertInvitedUser(tx, {
      companyId,
      email: input.email,
      mobile: input.mobile,
      name: input.name,
      createdBy: scope.userId,
    });

    const { token, tokenHash } = generateInviteToken();
    const newInvitation = await insertInvitation(tx, {
      companyId,
      email: input.email,
      tokenHash,
      roles: input.roles,
      invitedBy: scope.userId,
      expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    });

    await insertAuditLog(tx, {
      companyId,
      changedBy: scope.userId,
      entity: "user",
      entityId: user.id,
      action: "user.invited",
      after: { email: input.email, mobile: input.mobile, roles: input.roles, status: "invited" },
    });

    return {
      invitation: { ...newInvitation, rawToken: token },
      userId: user.id,
      companyName: (await findCompanyName(tx, companyId)) ?? "",
    };
  });

  const tenant = await getActiveTenantById(scope.tenantId);
  if (!tenant) {
    throw new NotFoundError("Tenant not found");
  }
  await getMailer().send(
    buildInviteEmail({ to: input.email, companyName, token: invitation.rawToken, tenantSlug: tenant.slug }),
  );

  return { invitationId: invitation.id, userId };
}

export interface ValidateInvitationResult {
  email: string;
  companyName: string;
}

export async function validateInvitation(
  hostname: string,
  tenantCode: string | undefined,
  token: string,
): Promise<ValidateInvitationResult> {
  const tenant = await resolveTenantForLogin(hostname, tenantCode);
  if (!tenant) {
    throw new NotFoundError("Invitation not found or expired");
  }

  const tokenHash = hashInviteToken(token);

  return withTenantSchema(tenant.schemaName, async (tx) => {
    const invitation = await findInvitationByTokenHash(tx, tokenHash);
    if (!invitation || !isInvitationUsable(invitation)) {
      throw new NotFoundError("Invitation not found or expired");
    }

    const companyName = await findCompanyName(tx, invitation.companyId);
    return { email: invitation.email, companyName: companyName ?? "" };
  });
}

export async function acceptInvitation(
  hostname: string,
  tenantCode: string | undefined,
  token: string,
  input: AcceptInvitationInput,
): Promise<void> {
  const tenant = await resolveTenantForLogin(hostname, tenantCode);
  if (!tenant) {
    throw new NotFoundError("Invitation not found or expired");
  }

  assertPasswordMeetsPolicy(input.password);
  const tokenHash = hashInviteToken(token);

  const { userId, roles, companyId } = await withTenantSchema(tenant.schemaName, async (tx) => {
    const invitation = await findInvitationByTokenHash(tx, tokenHash);
    if (!invitation || !isInvitationUsable(invitation)) {
      throw new NotFoundError("Invitation not found or expired");
    }

    const user = await findUserByCompanyAndEmail(tx, invitation.companyId, invitation.email);
    if (!user) {
      throw new NotFoundError("Invitation not found or expired");
    }

    const passwordHash = await hashPassword(input.password);
    await activateInvitedUser(tx, user.id, passwordHash);
    await markInvitationAccepted(tx, invitation.id);

    await insertAuditLog(tx, {
      companyId: invitation.companyId,
      changedBy: user.id,
      entity: "user",
      entityId: user.id,
      action: "user.invitation_accepted",
      before: { status: user.status, passwordHash: user.passwordHash },
      after: { status: "active", passwordHash: "<redacted>" },
    });

    return { userId: user.id, roles: invitation.roles, companyId: invitation.companyId };
  });

  // Deliberately outside the accept transaction: core/rbac/mutations.ts's
  // assignRoleToUser opens its own transaction per call (it isn't
  // tx-composable - see docs/adr/0006-user-onboarding.md), so this can't be
  // folded into the block above without either duplicating its insert logic
  // here or widening that module's public API for every existing caller.
  for (const roleId of roles) {
    await assignRoleToUser(tenant.schemaName, companyId, userId, roleId, userId);
  }
}

export interface ResendInvitationResult {
  expiresAt: Date;
}

export async function resendInvitation(
  ctx: RequestContext,
  invitationId: string,
): Promise<ResendInvitationResult> {
  const scope = requireTenantScope(ctx);

  const result = await withTenantDb(ctx, async (tx) => {
    const invitation = await findInvitationById(tx, scope.companyId, invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation not found");
    }
    if (invitation.status !== "pending") {
      throw new ConflictError(`Invitation is already ${invitation.status}`);
    }

    const { token, tokenHash } = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_MS);
    await renewInvitation(tx, invitation.id, { tokenHash, expiresAt });

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "invitation",
      entityId: invitation.id,
      action: "invitation.resent",
      before: { expiresAt: invitation.expiresAt },
      after: { expiresAt },
    });

    const companyName = (await findCompanyName(tx, scope.companyId)) ?? "";
    return { email: invitation.email, token, expiresAt, companyName };
  });

  const tenant = await getActiveTenantById(scope.tenantId);
  if (!tenant) {
    throw new NotFoundError("Tenant not found");
  }
  await getMailer().send(
    buildInviteEmail({
      to: result.email,
      companyName: result.companyName,
      token: result.token,
      tenantSlug: tenant.slug,
    }),
  );

  return { expiresAt: result.expiresAt };
}

export async function revokeInvitation(ctx: RequestContext, invitationId: string): Promise<void> {
  const scope = requireTenantScope(ctx);

  await withTenantDb(ctx, async (tx) => {
    const invitation = await findInvitationById(tx, scope.companyId, invitationId);
    if (!invitation) {
      throw new NotFoundError("Invitation not found");
    }
    if (invitation.status !== "pending") {
      throw new ConflictError(`Invitation is already ${invitation.status}`);
    }

    await markInvitationRevoked(tx, invitation.id);
    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "invitation",
      entityId: invitation.id,
      action: "invitation.revoked",
      before: { status: invitation.status },
      after: { status: "revoked" },
    });
  });
}

export interface ProvisionUserResult {
  userId: string;
}

export async function provisionUser(
  ctx: RequestContext,
  input: ProvisionUserInput,
): Promise<ProvisionUserResult> {
  const scope = requireTenantScope(ctx);
  const { companyId, tenantSchema } = scope;

  assertPasswordMeetsPolicy(input.tempPassword);

  const { userId } = await withTenantDb(ctx, async (tx) => {
    await assertRolesExist(tx, companyId, input.roles);

    if (await roleIdsHoldApprovalPermission(tx, input.roles)) {
      throw new ForbiddenError(
        "Provisioned accounts cannot hold a role with an approval permission - financial approvals require self-set credentials",
      );
    }

    const existing = await findActiveUserByMobile(tx, input.mobile);
    if (existing) {
      throw new ConflictError("A user with this mobile number already exists");
    }

    const passwordHash = await hashPassword(input.tempPassword);
    const user = await insertProvisionedUser(tx, {
      companyId,
      mobile: input.mobile,
      name: input.name,
      passwordHash,
      createdBy: scope.userId,
    });

    await insertAuditLog(tx, {
      companyId,
      changedBy: scope.userId,
      entity: "user",
      entityId: user.id,
      action: "user.provisioned",
      after: {
        mobile: input.mobile,
        roles: input.roles,
        status: "active",
        mustChangePassword: true,
      },
    });

    return { userId: user.id };
  });

  for (const roleId of input.roles) {
    await assignRoleToUser(tenantSchema, companyId, userId, roleId, scope.userId);
  }

  return { userId };
}

export async function changePassword(
  ctx: RequestContext,
  input: ChangePasswordInput,
): Promise<AuthTokens> {
  const scope = requireTenantScope(ctx);
  assertPasswordMeetsPolicy(input.newPassword);

  return withTenantDb(ctx, async (tx) => {
    const passwordHash = await hashPassword(input.newPassword);
    await setUserPassword(tx, scope.userId, passwordHash);

    await insertAuditLog(tx, {
      companyId: scope.companyId,
      changedBy: scope.userId,
      entity: "user",
      entityId: scope.userId,
      action: "user.password_changed",
      before: { mustChangePassword: true },
      after: { mustChangePassword: false },
    });

    return issueTokenPair(scope.tenantId, { id: scope.userId, companyId: scope.companyId }, tx);
  });
}
