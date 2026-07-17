import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import * as usersService from "./users.service.js";
import {
  acceptInvitationSchema,
  changePasswordSchema,
  inviteUserSchema,
  provisionUserSchema,
  validateInvitationQuerySchema,
} from "./users.validator.js";

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
