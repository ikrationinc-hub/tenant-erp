import { eq } from "drizzle-orm";
import { db } from "../../config/db.js";
import { tenants } from "../../database/platform/schema.js";

export interface ResolvedTenant {
  id: string;
  schemaName: string;
}

/**
 * Subdomain first, tenant-code field as fallback (task item 6). In
 * production an Nginx layer resolves the subdomain before the request ever
 * reaches this app; that layer doesn't exist in this repo yet, so the
 * subdomain is extracted from the Host header directly here instead.
 */
function extractSubdomainSlug(hostname: string): string | undefined {
  const labels = hostname.split(".");
  if (labels.length < 3) {
    // e.g. "localhost", a bare apex domain, or an IP - nothing to extract.
    return undefined;
  }
  const [candidate] = labels;
  return candidate && candidate !== "www" ? candidate : undefined;
}

/**
 * Returns undefined for "no active tenant resolved" rather than throwing -
 * the caller (auth.service login) must fold that into the same generic
 * invalid-credentials response as an unknown email or wrong password, never
 * a distinct "unknown tenant" error.
 */
export async function resolveTenantForLogin(
  hostname: string,
  tenantCode: string | undefined,
): Promise<ResolvedTenant | undefined> {
  const slugCandidates = [extractSubdomainSlug(hostname), tenantCode].filter(
    (value): value is string => Boolean(value),
  );

  for (const slug of slugCandidates) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (tenant && tenant.status === "active") {
      return { id: tenant.id, schemaName: tenant.schemaName };
    }
  }

  return undefined;
}

/**
 * Looks up a tenant by id (never trusting a schema name embedded directly
 * in a token) and confirms it's still active. Shared by scope-resolver
 * (every authenticated request) and auth.service (refresh/logout), so
 * "resolve this tenant id, and only if active" has exactly one
 * implementation.
 */
export async function getActiveTenantById(tenantId: string): Promise<ResolvedTenant | undefined> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant || tenant.status !== "active") {
    return undefined;
  }
  return { id: tenant.id, schemaName: tenant.schemaName };
}
