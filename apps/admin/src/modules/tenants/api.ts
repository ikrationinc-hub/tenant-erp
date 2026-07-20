import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  moduleCatalogueResponseSchema,
  provisionTenantResponseSchema,
  tenantDetailResponseSchema,
  tenantListResponseSchema,
  tenantModulesResponseSchema,
  tenantStatusUpdateResponseSchema,
  type ProvisionTenantRequest,
  type SetTenantModuleRequest,
} from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";

const TENANTS_KEY = ["platform", "tenants"] as const;
const TENANT_KEY = (id: string) => ["platform", "tenants", id] as const;
const TENANT_MODULES_KEY = (id: string) => ["platform", "tenants", id, "modules"] as const;
const MODULE_CATALOGUE_KEY = ["platform", "modules"] as const;

export function useTenantsQuery() {
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: () => apiFetch(endpoints.tenants, {}, { schema: tenantListResponseSchema }),
  });
}

export function useTenantQuery(id: string | undefined) {
  return useQuery({
    queryKey: TENANT_KEY(id ?? ""),
    queryFn: () => apiFetch(endpoints.tenant(id ?? ""), {}, { schema: tenantDetailResponseSchema }),
    enabled: Boolean(id),
  });
}

export function useModuleCatalogueQuery() {
  return useQuery({
    queryKey: MODULE_CATALOGUE_KEY,
    queryFn: () => apiFetch(endpoints.moduleCatalogue, {}, { schema: moduleCatalogueResponseSchema }),
  });
}

export function useTenantModulesQuery(id: string | undefined) {
  return useQuery({
    queryKey: TENANT_MODULES_KEY(id ?? ""),
    queryFn: () => apiFetch(endpoints.tenantModules(id ?? ""), {}, { schema: tenantModulesResponseSchema }),
    enabled: Boolean(id),
  });
}

export function useProvisionTenantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProvisionTenantRequest) =>
      apiFetch(
        endpoints.tenants,
        { method: "POST", body: input },
        { schema: provisionTenantResponseSchema },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TENANTS_KEY });
    },
  });
}

export function useSuspendTenantMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        endpoints.suspendTenant(id),
        { method: "POST" },
        { schema: tenantStatusUpdateResponseSchema },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TENANTS_KEY });
      void queryClient.invalidateQueries({ queryKey: TENANT_KEY(id) });
    },
  });
}

export function useReactivateTenantMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch(
        endpoints.reactivateTenant(id),
        { method: "POST" },
        { schema: tenantStatusUpdateResponseSchema },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TENANTS_KEY });
      void queryClient.invalidateQueries({ queryKey: TENANT_KEY(id) });
    },
  });
}

export function useSetTenantModuleMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetTenantModuleRequest) =>
      apiFetch(
        endpoints.tenantModules(id),
        { method: "PATCH", body: input },
        { schema: tenantModulesResponseSchema },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TENANTS_KEY });
      void queryClient.invalidateQueries({ queryKey: TENANT_MODULES_KEY(id) });
    },
  });
}
