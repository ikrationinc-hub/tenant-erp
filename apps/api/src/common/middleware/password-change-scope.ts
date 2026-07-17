import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../context/request-context.js";
import { ForbiddenError } from "../errors/index.js";

/**
 * Applied to every protected route EXCEPT the password-change endpoint
 * itself (modules/users/users.routes.ts's POST /users/me/password) - task
 * requirement "a token scoped to the password-change endpoint only." A
 * "full" scope (or no scope resolved yet, which requirePermission etc.
 * reject on their own) passes through untouched.
 */
export function enforcePasswordChangeScope(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const ctx = getRequestContext();
  if (ctx?.tenantScope?.scope === "password_change") {
    next(new ForbiddenError("Password must be changed before accessing this endpoint"));
    return;
  }
  next();
}
