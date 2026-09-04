/** Single source of truth for API paths - referenced by both the real fetch wrapper and the MSW mocks, so they can't drift apart. Mirrors apps/api/src/app.ts's mount points. */
export const endpoints = {
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
  /** C-3a (docs/CONTRACT-MODULE-BUILD.md): divisionId is optional - omitted entirely keeps the pre-C-3a request shape (no query string at all, via withQuery skipping undefined values). */
  fieldDefinitions: (module: string, entity: string, divisionId?: string) =>
    withQuery(`/field-definitions/${module}/${entity}`, { divisionId }),
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
  purchase: (id: string) => `/purchases/${id}`,
  issuePurchase: (id: string) => `/purchases/${id}/issue`,
  cancelPurchase: (id: string) => `/purchases/${id}/cancel`,
  purchaseItems: (purchaseId: string) => `/purchases/${purchaseId}/items`,
  purchaseItem: (purchaseId: string, itemId: string) => `/purchases/${purchaseId}/items/${itemId}`,
  purchaseAllocations: (purchaseId: string) => `/purchases/${purchaseId}/allocations`,
  purchaseAllocation: (purchaseId: string, allocationId: string) => `/purchases/${purchaseId}/allocations/${allocationId}`,
  purchaseCosts: (purchaseId: string) => `/purchases/${purchaseId}/costs`,
  purchaseLmeRecords: (purchaseId: string) => `/purchases/${purchaseId}/lme-records`,
  purchaseLmeRecord: (purchaseId: string, lmeRecordId: string) => `/purchases/${purchaseId}/lme-records/${lmeRecordId}`,
  purchaseHedges: (purchaseId: string) => `/purchases/${purchaseId}/hedges`,
  purchaseHedge: (purchaseId: string, hedgeId: string) => `/purchases/${purchaseId}/hedges/${hedgeId}`,
  purchaseInvoices: (purchaseId: string) => `/purchases/${purchaseId}/invoices`,
  purchaseInvoice: (purchaseId: string, invoiceId: string) => `/purchases/${purchaseId}/invoices/${invoiceId}`,
  approvePurchaseInvoice: (purchaseId: string, invoiceId: string) => `/purchases/${purchaseId}/invoices/${invoiceId}/approve`,
  purchaseReceipts: (purchaseId: string) => `/purchases/${purchaseId}/receipts`,
  confirmPurchaseReceipt: (purchaseId: string, receiptId: string) => `/purchases/${purchaseId}/receipts/${receiptId}/confirm`,
  // PL-4: the standalone, cross-purchase "Purchase Receipts"/"Purchase
  // Bills" list screens - own top-level paths (app.ts mounts these as
  // separate routers), not nested under /purchases/:id.
  allPurchaseReceipts: "/purchase-receipts",
  allPurchaseBills: "/purchase-bills",
  // PL-5: Payment - never nested under /purchases/:id at all (it's scoped
  // to a supplier, potentially settling bills across several purchases in
  // one record), its own top-level path from the start.
  payments: "/payments",
  payment: (id: string) => `/payments/${id}`,
  outstandingBillsForSupplier: (supplierId: string) => `/payments/outstanding-bills/${supplierId}`,
  uploadAttachment: (entity: string, entityId: string, fieldKey: string) =>
    `/attachments/${entity}/${entityId}/${fieldKey}`,
  attachmentDownloadUrl: (id: string) => `/attachments/${id}/download-url`,
  attachments: "/attachments",

  // --- FR-108: Inventory (Stock Ledger) - read-only over the API ------------
  inventoryBalances: "/inventory/balances",
  inventoryMovements: "/inventory/movements",
  inventoryMovementsForBalance: (itemId: string, warehouseId: string) => `/inventory/movements/${itemId}/${warehouseId}`,

  // --- C-3a/C-3b (docs/CONTRACT-MODULE-BUILD.md): the contract module -------
  clauses: "/clauses",
  clauseVersions: (clauseId: string) => `/clauses/${clauseId}/versions`,
  approveClauseVersion: (clauseId: string, versionId: string) => `/clauses/${clauseId}/versions/${versionId}/approve`,
  contracts: "/contracts",
  contract: (id: string) => `/contracts/${id}`,
  contractClauses: (id: string) => `/contracts/${id}/clauses`,
  contractClause: (id: string, contractClauseId: string) => `/contracts/${id}/clauses/${contractClauseId}`,
  reorderContractClauses: (id: string) => `/contracts/${id}/clauses/reorder`,
  resnapshotContractClauses: (id: string) => `/contracts/${id}/clauses/resnapshot`,
  contractPreview: (id: string) => `/contracts/${id}/preview`,
  approveContract: (id: string) => `/contracts/${id}/approve`,
  signContract: (id: string) => `/contracts/${id}/sign`,
  closeContract: (id: string) => `/contracts/${id}/close`,
  generateContract: (id: string) => `/contracts/${id}/generate`,
  contractGenerationStatus: (id: string, jobId: string) => `/contracts/${id}/generate/${jobId}`,
  contractDocumentUrl: (id: string) => `/contracts/${id}/document-url`,
  contractTemplates: "/contract-templates",
  contractTemplate: (id: string) => `/contract-templates/${id}`,
  contractTemplateClauses: (id: string) => `/contract-templates/${id}/clauses`,
  contractTemplateClause: (id: string, clauseId: string) => `/contract-templates/${id}/clauses/${clauseId}`,
  contractTemplateGenerateDefaultDocx: (id: string) => `/contract-templates/${id}/generate-default-docx`,

  // --- C-4 (docs/CONTRACT-MODULE-BUILD.md): rules, approval, e-signature, email
  clauseRules: "/clause-rules",
  clauseRule: (id: string) => `/clause-rules/${id}`,
  runContractRules: (id: string) => `/contracts/${id}/run-rules`,
  sendContractForApproval: (id: string) => `/contracts/${id}/send-for-approval`,
  reviseContract: (id: string) => `/contracts/${id}/revise`,
  emailContract: (id: string) => `/contracts/${id}/email`,
  sendContractForESignature: (id: string) => `/contracts/${id}/send-for-esignature`,
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
