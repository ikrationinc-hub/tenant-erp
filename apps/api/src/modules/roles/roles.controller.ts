import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { getPermissionCatalogue } from "../../core/module-registry/registry.js";
import * as rolesService from "./roles.service.js";
import {
  createRoleSchema,
  fieldPermissionsQuerySchema,
  grantRolePermissionSchema,
  rolesListQuerySchema,
  saveFieldPermissionsSchema,
  updateRoleSchema,
} from "./roles.validator.js";

function requireContext() {
  const ctx = getRequestContext();
  if (!ctx) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx;
}

function requireStringParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new UnauthorizedError(`Missing ${name}`);
  }
  return value;
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const query = rolesListQuerySchema.parse(req.query);
    const result = await rolesService.list(ctx, query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function listOptions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const options = await rolesService.listOptions(ctx);
    res.status(200).json({ options });
  } catch (error) {
    next(error);
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const input = createRoleSchema.parse(req.body);
    const row = await rolesService.create(ctx, input);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const id = requireStringParam(req.params.id, "id");
    const input = updateRoleSchema.parse(req.body);
    const row = await rolesService.rename(ctx, id, input);
    res.status(200).json(row);
  } catch (error) {
    next(error);
  }
}

export async function getGrantedPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const roleId = requireStringParam(req.params.roleId, "role id");
    const permissionKeys = await rolesService.getGrantedPermissions(ctx, roleId);
    res.status(200).json({ permissionKeys });
  } catch (error) {
    next(error);
  }
}

export async function grantPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const roleId = requireStringParam(req.params.roleId, "role id");
    const input = grantRolePermissionSchema.parse(req.body);
    await rolesService.grantPermission(ctx, roleId, input.permissionKey);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function revokePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const roleId = requireStringParam(req.params.roleId, "role id");
    const permissionKey = requireStringParam(req.params.permissionKey, "permission key");
    await rolesService.revokePermission(ctx, roleId, decodeURIComponent(permissionKey));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function getFieldPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const roleId = requireStringParam(req.params.roleId, "role id");
    const query = fieldPermissionsQuerySchema.parse(req.query);
    const fieldPermissions = await rolesService.getFieldPermissions(ctx, roleId, query.module, query.entity);
    res.status(200).json({ fieldPermissions });
  } catch (error) {
    next(error);
  }
}

export async function saveFieldPermissions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = requireContext();
    const roleId = requireStringParam(req.params.roleId, "role id");
    const input = saveFieldPermissionsSchema.parse(req.body);
    await rolesService.saveFieldPermissions(ctx, roleId, input);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export function getPermissionsCatalogue(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.status(200).json({ permissions: getPermissionCatalogue() });
  } catch (error) {
    next(error);
  }
}
