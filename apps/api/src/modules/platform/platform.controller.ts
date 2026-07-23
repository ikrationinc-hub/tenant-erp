import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../../common/context/request-context.js";
import { ConflictError, NotFoundError, UnauthorizedError } from "../../common/errors/index.js";
import { RESOLVED_MODULES } from "../../core/module-registry/registry.js";
import { setModuleEnabled } from "../../core/module-registry/tenant-modules.js";
import { verifyPlatformAdminToken } from "../../core/platform-auth/jwt.js";
import { provisionTenant } from "../../core/provisioning/provision-tenant.js";
import * as platformAuthService from "./platform-auth.service.js";
import { getPlatformHealth } from "./platform-health.service.js";
import { findTenantById, listTenantModules, listTenants, updateTenantStatus } from "./platform.repository.js";
import {
  platformLoginSchema,
  platformLogoutSchema,
  platformRefreshSchema,
  provisionTenantSchema,
  setTenantModuleSchema,
} from "./platform.validator.js";

const BEARER_PREFIX = "Bearer ";

function extractBearerToken(req: Request): string {
  const header = req.header("authorization");
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return header.slice(BEARER_PREFIX.length);
}

/** Mirrors modules/users/users.controller.ts's own local helper of the same name. */
function requireStringParam(value: string | string[] | undefined, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new UnauthorizedError(`Missing ${name}`);
  }
  return value;
}

function requirePlatformAdminId(): string {
  const ctx = getRequestContext();
  if (!ctx?.platformAdminId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return ctx.platformAdminId;
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = platformLoginSchema.parse(req.body);
    const userAgent = req.header("user-agent");

    const result = await platformAuthService.platformAdminLogin(input, {
      ...(req.ip ? { ip: req.ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = platformRefreshSchema.parse(req.body);
    const result = await platformAuthService.platformAdminRefresh(input.refreshToken);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = platformLogoutSchema.parse(req.body);
    requirePlatformAdminId();

    const claims = await verifyPlatformAdminToken(extractBearerToken(req));
    await platformAuthService.platformAdminLogout(input.refreshToken, claims.jti, claims.exp);

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function me(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const platformAdminId = requirePlatformAdminId();
    const result = await platformAuthService.platformAdminMe(platformAdminId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function createTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const platformAdminId = requirePlatformAdminId();
    const input = provisionTenantSchema.parse(req.body);
    const result = await provisionTenant(input, platformAdminId);
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * GET /platform/modules - the static module catalogue (key + name), with no
 * tenant context at all. ADM-4 needs this to populate the onboarding form's
 * module multi-select before a tenant exists to have per-tenant enabled
 * flags - unlike GET /tenants/:id/modules, there's no "enabled" here.
 */
export function listModuleCatalogue(_req: Request, res: Response, next: NextFunction): void {
  try {
    requirePlatformAdminId();
    const modules = RESOLVED_MODULES.map((manifest) => ({ key: manifest.key, name: manifest.name }));
    res.status(200).json({ modules });
  } catch (error) {
    next(error);
  }
}

/** GET /platform/tenants - metadata + aggregate counts only, never a browse of tenant business data (ADM-2 task item 1). */
export async function listAllTenants(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const rows = await listTenants();
    res.status(200).json({ tenants: rows });
  } catch (error) {
    next(error);
  }
}

/** GET /platform/tenants/:id - one tenant's metadata + enabled modules. Metadata only (ADM-2 task item 2). */
export async function getTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const tenant = await findTenantById(requireStringParam(req.params.id, "tenant id"));
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    const modules = await listTenantModules(tenant.id);
    res.status(200).json({ ...tenant, modules });
  } catch (error) {
    next(error);
  }
}

export async function suspendTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const tenant = await findTenantById(requireStringParam(req.params.id, "tenant id"));
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    if (tenant.status !== "active") {
      throw new ConflictError(`Tenant is not active (current status: ${tenant.status})`);
    }
    const updated = await updateTenantStatus(tenant.id, "suspended");
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function reactivateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const tenant = await findTenantById(requireStringParam(req.params.id, "tenant id"));
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    if (tenant.status !== "suspended") {
      throw new ConflictError(`Tenant is not suspended (current status: ${tenant.status})`);
    }
    const updated = await updateTenantStatus(tenant.id, "active");
    res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

/** GET /platform/tenants/:id/modules - the full module catalogue, each flagged enabled/disabled for this tenant. */
export async function getTenantModules(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const tenant = await findTenantById(requireStringParam(req.params.id, "tenant id"));
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    const rows = await listTenantModules(tenant.id);
    const enabledByKey = new Map(rows.map((row) => [row.moduleKey, row.enabled]));

    const modules = RESOLVED_MODULES.map((manifest) => ({
      key: manifest.key,
      name: manifest.name,
      enabled: enabledByKey.get(manifest.key) ?? false,
    }));

    res.status(200).json({ modules });
  } catch (error) {
    next(error);
  }
}

/** GET /platform/health - infrastructure status only (ADM-5). No business metrics anywhere in this payload. */
export async function getHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const result = await getPlatformHealth();
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function patchTenantModule(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requirePlatformAdminId();
    const tenant = await findTenantById(requireStringParam(req.params.id, "tenant id"));
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }
    const input = setTenantModuleSchema.parse(req.body);

    if (!RESOLVED_MODULES.some((manifest) => manifest.key === input.moduleKey)) {
      throw new NotFoundError(`Unknown module "${input.moduleKey}"`);
    }

    await setModuleEnabled(tenant.id, tenant.schemaName, input.moduleKey, input.enabled);

    const rows = await listTenantModules(tenant.id);
    const enabledByKey = new Map(rows.map((row) => [row.moduleKey, row.enabled]));
    const modules = RESOLVED_MODULES.map((manifest) => ({
      key: manifest.key,
      name: manifest.name,
      enabled: enabledByKey.get(manifest.key) ?? false,
    }));

    res.status(200).json({ modules });
  } catch (error) {
    next(error);
  }
}
