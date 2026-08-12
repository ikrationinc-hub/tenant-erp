/** Single source of truth for API paths - referenced by both the real fetch wrapper and the MSW mocks, so they can't drift apart. Mirrors apps/api/src/app.ts's mount points. */
export const endpoints = {
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
  fieldDefinitions: (module: string, entity: string) => `/field-definitions/${module}/${entity}`,
  fieldDefinitionModules: "/field-definitions/modules",
  fieldDefinition: (id: string) => `/field-definitions/${id}`,
  validateInvitation: (token: string) => `/invitations/${token}`,
  acceptInvitation: (token: string) => `/invitations/${token}/accept`,
  changePassword: "/users/me/password",
  myCompanies: "/users/me/companies",
  myPermissions: "/users/me/permissions",
  masterOptions: (master: string) => `/masters/${master}/options`,
  menus: "/menus",

  // --- FE-5.5: tenant-admin surface -----------------------------------------
  companies: "/companies",
  companyOptions: "/companies/options",
  branches: "/branches",
  users: "/users",
  suspendUser: (id: string) => `/users/${id}/suspend`,
  reactivateUser: (id: string) => `/users/${id}/reactivate`,
  setUserRoles: (id: string) => `/users/${id}/roles`,
  inviteUser: "/users/invite",
  provisionUser: "/users/provision",
  resendInvitation: (id: string) => `/users/invitations/${id}/resend`,
  revokeInvitation: (id: string) => `/users/invitations/${id}/revoke`,
  roles: "/roles",
  permissionCatalogue: "/permissions",
  roleGrantedPermissions: (roleId: string) => `/roles/${roleId}/permissions`,
  grantRolePermission: (roleId: string) => `/roles/${roleId}/permissions`,
  revokeRolePermission: (roleId: string, permissionKey: string) =>
    `/roles/${roleId}/permissions/${encodeURIComponent(permissionKey)}`,
  roleFieldPermissions: (roleId: string) => `/roles/${roleId}/field-permissions`,
  userOptions: "/users/options",
  branchOptions: "/branches/options",

  // --- FE-6: Supplier + Purchase --------------------------------------------
  suppliers: "/suppliers",
  supplierOptions: "/suppliers/options",
  activateSupplier: (id: string) => `/suppliers/${id}/activate`,
  deactivateSupplier: (id: string) => `/suppliers/${id}/deactivate`,
  brokers: "/brokers",
  brokerOptions: "/brokers/options",
  activateBroker: (id: string) => `/brokers/${id}/activate`,
  deactivateBroker: (id: string) => `/brokers/${id}/deactivate`,
  purchases: "/purchases",
  approvePurchase: (id: string) => `/purchases/${id}/approve`,
  postPurchase: (id: string) => `/purchases/${id}/post`,
  purchaseItems: (purchaseId: string) => `/purchases/${purchaseId}/items`,
  purchaseItem: (purchaseId: string, itemId: string) => `/purchases/${purchaseId}/items/${itemId}`,
  purchaseAllocations: (purchaseId: string) => `/purchases/${purchaseId}/allocations`,
  purchaseCosts: (purchaseId: string) => `/purchases/${purchaseId}/costs`,
  purchaseLmeRecords: (purchaseId: string) => `/purchases/${purchaseId}/lme-records`,
  purchaseHedges: (purchaseId: string) => `/purchases/${purchaseId}/hedges`,
  purchaseHedge: (purchaseId: string, hedgeId: string) => `/purchases/${purchaseId}/hedges/${hedgeId}`,
  purchaseInvoices: (purchaseId: string) => `/purchases/${purchaseId}/invoices`,
  purchaseInvoice: (purchaseId: string, invoiceId: string) => `/purchases/${purchaseId}/invoices/${invoiceId}`,
  approvePurchaseInvoice: (purchaseId: string, invoiceId: string) => `/purchases/${purchaseId}/invoices/${invoiceId}/approve`,
  uploadAttachment: (entity: string, entityId: string, fieldKey: string) =>
    `/attachments/${entity}/${entityId}/${fieldKey}`,
  attachmentDownloadUrl: (id: string) => `/attachments/${id}/download-url`,
  attachments: "/attachments",

  // --- FR-108: Inventory (Stock Ledger) - read-only over the API ------------
  inventoryBalances: "/inventory/balances",
  inventoryMovements: "/inventory/movements",
  inventoryMovementsForBalance: (itemId: string, warehouseId: string) => `/inventory/movements/${itemId}/${warehouseId}`,
} as const;

/** Appends a query string, skipping undefined values - `?tenantCode=` for an unset optional field is just noise. */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
