import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../config/db.js";
import { tenants } from "../../database/platform/schema.js";
import { UnauthorizedError } from "../errors/index.js";
import { setTenantScope } from "../context/request-context.js";

const BEARER_PREFIX = "Bearer ";

/**
 * STUB claims decoder - NOT a real JWT verification. Real auth (jose,
 * signature verification, expiry) is the next prompt. This exists only so
 * scope resolution (tenant -> company -> branch, from the token ONLY, per
 * rule 2) can be built and tested now, ahead of real auth landing on top of
 * it without changing this function's contract: still "claims in, TenantScope
 * out."
 */
const stubTokenClaimsSchema = z.object({
  tenantId: z.string().uuid(),
  companyId: z.string().uuid(),
  branchId: z.string().uuid().optional(),
});

export type StubTokenClaims = z.infer<typeof stubTokenClaimsSchema>;

function decodeStubToken(authorizationHeader: string | undefined): StubTokenClaims {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length);

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new UnauthorizedError("Malformed token");
  }

  const parsed = stubTokenClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new UnauthorizedError("Malformed token claims");
  }

  return parsed.data;
}

/**
 * Resolves tenant -> company -> branch from the JWT ONLY (rule 2) - never
 * body, query, or any other header. The tenant schema name is looked up from
 * the platform tenants table (not trusted from the token), so a forged or
 * stale tenantId can never resolve to a schema at all, and a suspended
 * tenant is rejected here rather than at the query layer.
 */
export async function scopeResolverMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const claims = decodeStubToken(req.header("authorization"));

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, claims.tenantId)).limit(1);

    if (!tenant || tenant.status !== "active") {
      throw new UnauthorizedError("Unknown or inactive tenant");
    }

    setTenantScope({
      tenantId: tenant.id,
      tenantSchema: tenant.schemaName,
      companyId: claims.companyId,
      ...(claims.branchId ? { branchId: claims.branchId } : {}),
    });

    next();
  } catch (error) {
    next(error);
  }
}
