import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../context/request-context.js";
import { resolve } from "../../core/rbac/resolve.js";
import { ForbiddenError, UnauthorizedError } from "../errors/index.js";

/**
 * The ONE reusable permission check in the codebase (task item 4) - never
 * an inline role-name string comparison anywhere else outside core/rbac
 * (scripts/check-rbac-boundary.mjs enforces this, wired into `pnpm lint`).
 */
export function requirePermission(permissionKey: string) {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = getRequestContext();
      if (!ctx?.tenantScope?.userId) {
        throw new UnauthorizedError("Missing bearer token");
      }

      const resolved = await resolve(ctx);
      if (!resolved.permissions.has(permissionKey)) {
        throw new ForbiddenError(`Missing permission: ${permissionKey}`, { permission: permissionKey });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
