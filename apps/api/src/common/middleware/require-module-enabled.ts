import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../context/request-context.js";
import { isModuleEnabledForTenant } from "../../core/module-registry/tenant-modules.js";
import { NotFoundError, UnauthorizedError } from "../errors/index.js";

/**
 * 404, never 403 (task requirement): telling an unauthorized-but-otherwise-
 * valid caller "this exists but you can't have it" (403) leaks that the
 * module exists at all. A disabled module should look identical to a
 * route that was never registered.
 *
 * Requires tenantScope to already be resolved (mount AFTER
 * scopeResolverMiddleware), which is why this can't gate a module's
 * pre-authentication routes (auth's /login, /refresh, or users'
 * /invitations/:token accept flow) - there is no tenant to check
 * enablement against until a token has already been verified. Those
 * routes are structurally exempt, not just conventionally excluded - see
 * core/module-registry/manifests.ts's doc comment.
 */
export function requireModuleEnabled(moduleKey: string) {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = getRequestContext();
      if (!ctx?.tenantScope?.tenantId) {
        throw new UnauthorizedError("Missing bearer token");
      }

      const enabled = await isModuleEnabledForTenant(ctx.tenantScope.tenantId, moduleKey);
      if (!enabled) {
        throw new NotFoundError();
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
