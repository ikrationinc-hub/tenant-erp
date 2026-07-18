import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../context/request-context.js";
import { verifyPlatformAdminToken } from "../../core/platform-auth/jwt.js";
import { isJtiDenylisted } from "../../core/auth/denylist.js";
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

    // A denylisted jti (logout/revocation) is rejected before any of that -
    // mirrors scope-resolver.ts's tenant-side check exactly.
    if (await isJtiDenylisted(claims.jti)) {
      throw new UnauthorizedError("Token has been revoked");
    }

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
