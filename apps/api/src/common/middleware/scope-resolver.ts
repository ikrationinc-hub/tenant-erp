import type { NextFunction, Request, Response } from "express";
import { setTenantScope } from "../context/request-context.js";
import { isJtiDenylisted } from "../../core/auth/denylist.js";
import { verifyAccessToken } from "../../core/auth/jwt.js";
import { getActiveTenantById } from "../../core/auth/tenant-resolver.js";
import { UnauthorizedError } from "../errors/index.js";

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return authorizationHeader.slice(BEARER_PREFIX.length);
}

/**
 * Resolves tenant -> company -> branch -> user from the JWT ONLY (rule 2) -
 * never body, query, or any other header. The tenant schema name is looked
 * up from the platform tenants table (never trusted from the token itself),
 * so a forged or stale tenant claim can never resolve to a schema at all,
 * and a suspended tenant is rejected here rather than at the query layer.
 * A denylisted jti (logout/revocation) is rejected before any of that.
 */
export async function scopeResolverMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.header("authorization"));
    const claims = await verifyAccessToken(token);

    if (await isJtiDenylisted(claims.jti)) {
      throw new UnauthorizedError("Token has been revoked");
    }

    const tenant = await getActiveTenantById(claims.tenant);
    if (!tenant) {
      throw new UnauthorizedError("Unknown or inactive tenant");
    }

    setTenantScope({
      tenantId: tenant.id,
      tenantSchema: tenant.schemaName,
      companyId: claims.company_id,
      userId: claims.sub,
      roles: claims.roles,
      scope: claims.scope,
      ...(claims.branch_id ? { branchId: claims.branch_id } : {}),
    });

    next();
  } catch (error) {
    next(error);
  }
}
