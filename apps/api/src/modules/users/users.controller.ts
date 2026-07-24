import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import type { UserRow } from "./users.repository.js";
import * as usersService from "./users.service.js";
import {
  acceptInvitationSchema,
  changePasswordSchema,
  inviteUserSchema,
  provisionUserSchema,
  setUserRolesSchema,
  usersListQuerySchema,
  validateInvitationQuerySchema,
} from "./users.validator.js";

/** Never serialize a raw UserRow - it carries passwordHash. Every response below is this shape, not the repository row directly. */
function toSafeUser(row: UserRow) {
  return {
    id: row.id,
    companyId: row.companyId,
    email: row.email,
    mobile: row.mobile,
    name: row.name,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
  };
}

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

export async function invite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = inviteUserSchema.parse(req.body);
    const ctx = requireContext();
    const result = await usersService.inviteUser(ctx, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function provision(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = provisionUserSchema.parse(req.body);
    const ctx = requireContext();
    const result = await usersService.provisionUser(ctx, input);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = changePasswordSchema.parse(req.body);
    const ctx = requireContext();
    const result = await usersService.changePassword(ctx, input);
    res.status(200).json({ ...result, mustChangePassword: false });
  } catch (error) {
    next(error);
  }
}

function requireStringParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new UnauthorizedError(`Missing ${name}`);
  }
  return value;
}

export async function resendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const invitationId = requireStringParam(req.params.id, "invitation id");
    const result = await usersService.resendInvitation(ctx, invitationId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function revokeInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const invitationId = requireStringParam(req.params.id, "invitation id");
    await usersService.revokeInvitation(ctx, invitationId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function validateInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = validateInvitationQuerySchema.parse(req.query);
    const token = requireStringParam(req.params.token, "invitation token");
    const result = await usersService.validateInvitation(req.hostname, query.tenantCode, token);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = acceptInvitationSchema.parse(req.body);
    const token = requireStringParam(req.params.token, "invitation token");
    await usersService.acceptInvitation(req.hostname, input.tenantCode, token, input);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = usersListQuerySchema.parse(req.query);
    const result = await usersService.listUsers(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function myPermissions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const permissions = await usersService.myPermissions(ctx);
    res.status(200).json({ permissions });
  } catch (error) {
    next(error);
  }
}

export async function suspend(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "id");
    const row = await usersService.suspendUser(ctx, id);
    res.status(200).json(toSafeUser(row));
  } catch (error) {
    next(error);
  }
}

export async function reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "id");
    const row = await usersService.reactivateUser(ctx, id);
    res.status(200).json(toSafeUser(row));
  } catch (error) {
    next(error);
  }
}

export async function setRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "id");
    const input = setUserRolesSchema.parse(req.body);
    const row = await usersService.setUserRoles(ctx, id, input);
    res.status(200).json({ ...toSafeUser(row), roleIds: input.roleIds });
  } catch (error) {
    next(error);
  }
}
