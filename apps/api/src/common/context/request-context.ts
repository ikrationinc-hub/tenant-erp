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
}

export interface RequestContext {
  requestId: string;
  tenantScope?: TenantScope;
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
