import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../context/request-context.js";
import { verifyPlatformAdminToken } from "../../core/platform-auth/jwt.js";
import { UnauthorizedError } from "../errors/index.js";

const BEARER_PREFIX = "Bearer ";

/** Mirrors common/middleware/scope-resolver.ts's shape, for platform-admin-only routes (task item 4: "POST /api/v1/platform/tenants - platform-admin auth only"). */
export async function platformAdminAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.header("authorization");
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedError("Missing bearer token");
    }
    const token = header.slice(BEARER_PREFIX.length);
    const claims = await verifyPlatformAdminToken(token);

    const ctx = getRequestContext();
    if (!ctx) {
      throw new Error("platformAdminAuthMiddleware called outside of a request context");
    }
    ctx.platformAdminId = claims.sub;

    next();
  } catch (error) {
    next(error);
  }
}
