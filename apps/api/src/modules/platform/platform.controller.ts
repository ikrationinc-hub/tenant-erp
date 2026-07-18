import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { provisionTenant } from "../../core/provisioning/provision-tenant.js";
import { platformAdminLogin } from "./platform-auth.service.js";
import { platformLoginSchema, provisionTenantSchema } from "./platform.validator.js";

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = platformLoginSchema.parse(req.body);
    const result = await platformAdminLogin(input);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function createTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getRequestContext();
    if (!ctx?.platformAdminId) {
      throw new UnauthorizedError("Missing bearer token");
    }

    const input = provisionTenantSchema.parse(req.body);
    const result = await provisionTenant(input, ctx.platformAdminId);
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
}
