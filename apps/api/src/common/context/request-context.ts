import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Resolved from the JWT ONLY (rule 2) - never body, query, or header. Set once
 * by scope-resolver middleware, then read by repositories via withTenantDb.
 */
export interface TenantScope {
  tenantId: string;
  tenantSchema: string;
  companyId: string;
  branchId?: string;
  /** The authenticated user (JWT `sub`) and their roles. Optional: some
   * scopes (e.g. tenant-isolation tests exercising get-db.ts directly) have
   * no real logged-in user behind them. */
  userId?: string;
  roles?: string[];
  /**
   * The access token's own `scope` claim ("full" | "password_change") -
   * NOT to be confused with TenantScope itself. "password_change" means
   * every route except the password-change endpoint must reject the
   * request (common/middleware/password-change-scope.ts). Optional for the
   * same reason userId is: some scopes have no real token behind them.
   */
  scope?: "full" | "password_change";
}

export interface RequestContext {
  requestId: string;
  tenantScope?: TenantScope;
  /** Populated once by request-context.middleware.ts - read by core/audit/write.ts so callers never have to thread these through every insertAuditLog call. */
  ip?: string;
  userAgent?: string;
  /**
   * Set by common/middleware/platform-admin-auth.ts, mutually exclusive
   * with tenantScope in practice (a platform admin token carries no tenant
   * claims at all - core/platform-auth/jwt.ts). Kept as its own field
   * rather than folded into TenantScope: a platform admin isn't scoped to
   * any tenant, so giving it a home inside TenantScope would misrepresent
   * what it is.
   */
  platformAdminId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function setTenantScope(scope: TenantScope): void {
  const store = storage.getStore();
  if (!store) {
    throw new Error("setTenantScope called outside of a request context");
  }
  store.tenantScope = scope;
}

export function getTenantScope(): TenantScope | undefined {
  return storage.getStore()?.tenantScope;
}
