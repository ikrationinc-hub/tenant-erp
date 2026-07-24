import { http, HttpResponse } from "msw";
import {
  fieldDefinitionsResponseSchema,
  inviteUserResponseSchema,
  masterOptionsResponseSchema,
  paginatedRowsResponseSchema,
  permissionCatalogueResponseSchema,
  provisionUserResponseSchema,
  resendInvitationResponseSchema,
  type FieldDefinitionsResponse,
  type MasterOption,
  type PermissionCatalogueEntry,
} from "@hyperion/contracts";
import { endpoints } from "../core/api/endpoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

// --- Field definitions for the FE-5.5 admin entities ------------------------
// None of these have a real field-engine entry yet (companies/branches/
// users-admin/roles aren't Tier-2 masters) - same forward-looking pattern
// as masters-handlers.ts, kept minimal to exactly what each screen renders.

const companyFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "admin",
  entity: "company",
  fields: [
    { fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 0 },
    {
      fieldKey: "countryId",
      label: "Country",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 1,
      optionsSource: "masters:countries",
    },
    {
      fieldKey: "currencyId",
      label: "Currency",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
      optionsSource: "masters:currencies",
    },
    {
      fieldKey: "fiscalYearStartMonth",
      label: "Fiscal Year Start Month",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 3,
      optionsSource: {
        type: "static",
        staticOptions: Array.from({ length: 12 }, (_, index) => ({
          value: String(index + 1),
          label: new Date(2000, index, 1).toLocaleString("en", { month: "long" }),
        })),
      },
    },
    { fieldKey: "timezone", label: "Timezone", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4 },
    {
      fieldKey: "taxRegistrationNo",
      label: "Tax Registration No.",
      dataType: "text",
      isMandatory: false,
      isEditable: true,
      isSystem: false,
      sortOrder: 5,
    },
    {
      fieldKey: "status",
      label: "Status",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 6,
      optionsSource: {
        type: "static",
        staticOptions: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    },
  ],
});

const branchFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "admin",
  entity: "branch",
  fields: [
    { fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 0 },
    { fieldKey: "code", label: "Code", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 1 },
    {
      fieldKey: "status",
      label: "Status",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
      optionsSource: {
        type: "static",
        staticOptions: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    },
    // company_id is deliberately NOT a field here - the backend injects it
    // from the request's tenant scope (backend rule 2), never a form field.
  ],
});

const userFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "users",
  entity: "user",
  fields: [
    { fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: false, isSystem: true, sortOrder: 0 },
    { fieldKey: "email", label: "Email", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 1 },
    { fieldKey: "mobile", label: "Mobile", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 2 },
    { fieldKey: "status", label: "Status", dataType: "select", isMandatory: true, isEditable: false, isSystem: true, sortOrder: 3 },
    { fieldKey: "lastLoginAt", label: "Last Login", dataType: "datetime", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 4 },
  ],
});

const inviteFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "users",
  entity: "invite",
  fields: [
    { fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0 },
    { fieldKey: "email", label: "Email", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
    { fieldKey: "mobile", label: "Mobile", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 2 },
    {
      fieldKey: "roles",
      label: "Roles",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 3,
      multiple: true,
      optionsSource: "roles",
    },
    // Deliberately no password field - BE-7: admins never set passwords.
  ],
});

const provisionFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "users",
  entity: "provision",
  fields: [
    { fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0 },
    { fieldKey: "mobile", label: "Mobile", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
    {
      fieldKey: "tempPassword",
      label: "Temporary Password",
      dataType: "text",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
    },
    {
      fieldKey: "roles",
      label: "Roles",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 3,
      multiple: true,
      optionsSource: "roles",
    },
  ],
});

const editRolesFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "users",
  entity: "edit-roles",
  fields: [
    {
      fieldKey: "roleIds",
      label: "Roles",
      dataType: "select",
      isMandatory: false,
      isEditable: true,
      isSystem: false,
      sortOrder: 0,
      multiple: true,
      optionsSource: "roles",
    },
  ],
});

const roleFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "admin",
  entity: "role",
  fields: [{ fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 0 }],
});

const ADMIN_FIELD_DEFINITIONS: FieldDefinitionsResponse[] = [
  companyFieldDefinitions,
  branchFieldDefinitions,
  userFieldDefinitions,
  inviteFieldDefinitions,
  provisionFieldDefinitions,
  editRolesFieldDefinitions,
  roleFieldDefinitions,
];

export function resolveAdminFieldDefinitions(module: string, entity: string): FieldDefinitionsResponse | undefined {
  return ADMIN_FIELD_DEFINITIONS.find((schema) => schema.module === module && schema.entity === entity);
}

// --- Mock data ---------------------------------------------------------------

export interface MockRow extends Record<string, unknown> {
  id: string;
}

const companies: MockRow[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Hyperion Metals Trading",
    countryId: "ae",
    currencyId: "aed",
    fiscalYearStartMonth: "1",
    timezone: "Asia/Dubai",
    taxRegistrationNo: "TRN-1000",
    status: "active",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Hyperion Singapore Pte Ltd",
    countryId: "sg",
    currencyId: "sgd",
    fiscalYearStartMonth: "4",
    timezone: "Asia/Singapore",
    taxRegistrationNo: "TRN-2000",
    status: "active",
  },
];

const branches: MockRow[] = [
  { id: "33333333-3333-4333-8333-333333333333", name: "Dubai HQ", code: "DXB-HQ", status: "active" },
  { id: "44444444-4444-4444-8444-444444444444", name: "Jebel Ali Warehouse", code: "DXB-JAW", status: "active" },
];

const roles: MockRow[] = [
  { id: "role-admin", name: "Admin" },
  { id: "role-manager", name: "Manager" },
  { id: "role-officer", name: "Officer" },
  { id: "role-viewer", name: "Viewer" },
];

const users: MockRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Demo Admin",
    email: "demo.admin@hyperion.test",
    mobile: "+971500000001",
    status: "active",
    lastLoginAt: new Date().toISOString(),
    roleIds: ["role-admin"],
    invitationId: null,
    invitationExpiresAt: null,
  },
  {
    id: "u-2",
    name: "Amina Officer",
    email: "amina@hyperion.test",
    mobile: "+971500000002",
    status: "active",
    lastLoginAt: new Date(Date.now() - 86_400_000).toISOString(),
    roleIds: ["role-officer"],
    invitationId: null,
    invitationExpiresAt: null,
  },
  {
    id: "u-3",
    name: "Rashid Manager",
    email: "rashid@hyperion.test",
    mobile: "+971500000003",
    status: "suspended",
    lastLoginAt: null,
    roleIds: ["role-manager"],
    invitationId: null,
    invitationExpiresAt: null,
  },
  {
    id: "u-4",
    name: "New Hire",
    email: "new.hire@hyperion.test",
    mobile: "+971500000004",
    status: "invited",
    lastLoginAt: null,
    roleIds: ["role-viewer"],
    invitationId: "inv-1",
    invitationExpiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  },
];

const permissionCatalogue: PermissionCatalogueEntry[] = [
  { key: "masters.country.read", module: "masters", entity: "country", action: "read", description: "View country master records" },
  { key: "masters.country.update", module: "masters", entity: "country", action: "update", description: "Edit a country master record" },
  { key: "users.user.read", module: "users", entity: "user", action: "read", description: "View users" },
  { key: "users.user.create", module: "users", entity: "user", action: "create", description: "Invite/resend/revoke a user" },
  { key: "users.user.update", module: "users", entity: "user", action: "update", description: "Suspend/reactivate a user, edit roles" },
  { key: "users.user.provision", module: "users", entity: "user", action: "provision", description: "Provision a user without email" },
  { key: "admin.role.read", module: "admin", entity: "role", action: "read", description: "View roles" },
  { key: "admin.role.create", module: "admin", entity: "role", action: "create", description: "Create a role" },
  { key: "admin.role.update", module: "admin", entity: "role", action: "update", description: "Rename a role, manage its permissions" },
  { key: "admin.company.read", module: "admin", entity: "company", action: "read", description: "View companies" },
  { key: "admin.company.create", module: "admin", entity: "company", action: "create", description: "Add a company" },
  { key: "admin.company.update", module: "admin", entity: "company", action: "update", description: "Edit a company" },
  { key: "admin.branch.read", module: "admin", entity: "branch", action: "read", description: "View branches" },
  { key: "admin.branch.create", module: "admin", entity: "branch", action: "create", description: "Add a branch" },
  { key: "admin.branch.update", module: "admin", entity: "branch", action: "update", description: "Edit a branch" },
  { key: "purchase.po.read", module: "purchase", entity: "po", action: "read", description: "View purchases" },
  { key: "purchase.po.create", module: "purchase", entity: "po", action: "create", description: "Create a purchase, add items/allocations/LME records/hedges" },
  { key: "purchase.po.update", module: "purchase", entity: "po", action: "update", description: "Edit a draft purchase, set additional costs, close a hedge" },
  { key: "purchase.po.approve", module: "purchase", entity: "po", action: "approve", description: "Approve a purchase" },
  { key: "purchase.po.post", module: "purchase", entity: "po", action: "post", description: "Post an approved purchase" },
  { key: "suppliers.supplier.read", module: "suppliers", entity: "supplier", action: "read", description: "View suppliers" },
  { key: "suppliers.supplier.create", module: "suppliers", entity: "supplier", action: "create", description: "Create a supplier" },
  { key: "suppliers.supplier.update", module: "suppliers", entity: "supplier", action: "update", description: "Edit, activate, or deactivate a supplier" },
  { key: "storage.attachment.create", module: "storage", entity: "attachment", action: "create", description: "Upload an attachment" },
  { key: "storage.attachment.read", module: "storage", entity: "attachment", action: "read", description: "Download an attachment" },
];

const rolePermissions = new Map<string, Set<string>>([
  ["role-admin", new Set(permissionCatalogue.map((entry) => entry.key))],
  ["role-manager", new Set(["masters.country.read", "users.user.read", "purchase.po.read", "purchase.po.create", "purchase.po.approve"])],
  ["role-officer", new Set(["masters.country.read", "purchase.po.read", "purchase.po.create"])],
  ["role-viewer", new Set(["masters.country.read", "purchase.po.read"])],
]);

interface FieldPermissionEntry {
  fieldKey: string;
  canView: boolean;
  canEdit: boolean;
}
const roleFieldPermissions = new Map<string, FieldPermissionEntry[]>();

function fieldPermKey(roleId: string, module: string, entity: string): string {
  return `${roleId}:${module}.${entity}`;
}

const roleOptions: MasterOption[] = roles.map((role) => ({ value: role.id, label: String(role.name) }));

// --- Handlers -----------------------------------------------------------------

export function listHandler(rows: MockRow[]) {
  return ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const search = url.searchParams.get("search")?.toLowerCase();
    const statusParam = url.searchParams.get("status");
    const roleIdParam = url.searchParams.get("roleId");

    let filtered = rows;
    if (search) {
      filtered = filtered.filter((row) =>
        Object.values(row).some((value) => typeof value === "string" && value.toLowerCase().includes(search)),
      );
    }
    if (statusParam) {
      filtered = filtered.filter((row) => row.status === statusParam);
    }
    if (roleIdParam) {
      filtered = filtered.filter((row) => Array.isArray(row.roleIds) && row.roleIds.includes(roleIdParam));
    }

    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return HttpResponse.json(paginatedRowsResponseSchema.parse({ items, total, page, pageSize }));
  };
}

export function createHandler(rows: MockRow[], prefix: string) {
  return async ({ request }: { request: Request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const row: MockRow = { ...body, id: `${prefix}-${rows.length + 1}` };
    rows.push(row);
    return HttpResponse.json(row, { status: 201 });
  };
}

export function updateHandler(rows: MockRow[]) {
  return async ({ params, request }: { params: { id?: string | readonly string[] }; request: Request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(row, body);
    return HttpResponse.json(row);
  };
}

export const adminHandlers = [
  http.get(`${API_BASE}${endpoints.companies}`, listHandler(companies)),
  http.post(`${API_BASE}${endpoints.companies}`, createHandler(companies, "company")),
  http.patch(`${API_BASE}${endpoints.companies}/:id`, updateHandler(companies)),

  http.get(`${API_BASE}${endpoints.branches}`, listHandler(branches)),
  http.post(`${API_BASE}${endpoints.branches}`, createHandler(branches, "branch")),
  http.patch(`${API_BASE}${endpoints.branches}/:id`, updateHandler(branches)),

  http.get(`${API_BASE}${endpoints.roles}`, listHandler(roles)),
  http.post(`${API_BASE}${endpoints.roles}`, createHandler(roles, "role")),
  http.patch(`${API_BASE}${endpoints.roles}/:id`, updateHandler(roles)),
  http.get(`${API_BASE}${endpoints.roles}/options`, () => HttpResponse.json(masterOptionsResponseSchema.parse({ options: roleOptions }))),

  http.get(`${API_BASE}${endpoints.permissionCatalogue}`, () =>
    HttpResponse.json(permissionCatalogueResponseSchema.parse({ permissions: permissionCatalogue })),
  ),

  http.get(`${API_BASE}${endpoints.roles}/:roleId/permissions`, ({ params }) => {
    const roleId = typeof params.roleId === "string" ? params.roleId : "";
    const granted = rolePermissions.get(roleId) ?? new Set<string>();
    return HttpResponse.json({ permissionKeys: [...granted] });
  }),
  http.post(`${API_BASE}${endpoints.roles}/:roleId/permissions`, async ({ params, request }) => {
    const roleId = typeof params.roleId === "string" ? params.roleId : "";
    const body = (await request.json()) as { permissionKey: string };
    const granted = rolePermissions.get(roleId) ?? new Set<string>();
    granted.add(body.permissionKey);
    rolePermissions.set(roleId, granted);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete(`${API_BASE}${endpoints.roles}/:roleId/permissions/:permissionKey`, ({ params }) => {
    const roleId = typeof params.roleId === "string" ? params.roleId : "";
    const permissionKey = typeof params.permissionKey === "string" ? decodeURIComponent(params.permissionKey) : "";
    rolePermissions.get(roleId)?.delete(permissionKey);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE}${endpoints.roles}/:roleId/field-permissions`, ({ params, request }) => {
    const roleId = typeof params.roleId === "string" ? params.roleId : "";
    const url = new URL(request.url);
    const module = url.searchParams.get("module") ?? "";
    const entity = url.searchParams.get("entity") ?? "";
    const rows = roleFieldPermissions.get(fieldPermKey(roleId, module, entity)) ?? [];
    return HttpResponse.json({ fieldPermissions: rows });
  }),
  http.put(`${API_BASE}${endpoints.roles}/:roleId/field-permissions`, async ({ params, request }) => {
    const roleId = typeof params.roleId === "string" ? params.roleId : "";
    const body = (await request.json()) as { module: string; entity: string; rows: FieldPermissionEntry[] };
    roleFieldPermissions.set(fieldPermKey(roleId, body.module, body.entity), body.rows);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${API_BASE}${endpoints.users}`, listHandler(users)),
  http.get(`${API_BASE}${endpoints.userOptions}`, () =>
    HttpResponse.json(masterOptionsResponseSchema.parse({ options: users.map((user) => ({ value: user.id, label: String(user.name) })) })),
  ),
  http.get(`${API_BASE}${endpoints.branchOptions}`, () =>
    HttpResponse.json(masterOptionsResponseSchema.parse({ options: branches.map((branch) => ({ value: branch.id, label: String(branch.name) })) })),
  ),
  http.patch(`${API_BASE}${endpoints.suspendUser(":id")}`, ({ params }) => {
    const row = users.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    row.status = "suspended";
    return HttpResponse.json(row);
  }),
  http.patch(`${API_BASE}${endpoints.reactivateUser(":id")}`, ({ params }) => {
    const row = users.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    row.status = "active";
    return HttpResponse.json(row);
  }),
  http.put(`${API_BASE}${endpoints.setUserRoles(":id")}`, async ({ params, request }) => {
    const row = users.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as { roleIds: string[] };
    row.roleIds = body.roleIds;
    return HttpResponse.json(row);
  }),

  http.post(`${API_BASE}${endpoints.inviteUser}`, async ({ request }) => {
    const body = (await request.json()) as { name: string; email: string; mobile: string; roles: string[] };
    const id = `u-${users.length + 1}`;
    const invitationId = `inv-${users.length + 1}`;
    users.push({
      id,
      name: body.name,
      email: body.email,
      mobile: body.mobile,
      status: "invited",
      lastLoginAt: null,
      roleIds: body.roles,
      invitationId,
      invitationExpiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    return HttpResponse.json(inviteUserResponseSchema.parse({ invitationId, userId: id }), { status: 201 });
  }),

  http.post(`${API_BASE}${endpoints.provisionUser}`, async ({ request }) => {
    const body = (await request.json()) as { name: string; mobile: string; tempPassword: string; roles: string[] };
    const approvalRoles = new Set(["role-admin", "role-manager"]);
    if (body.roles.some((roleId) => approvalRoles.has(roleId))) {
      return HttpResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message:
              "Provisioned accounts cannot hold a role with an approval permission - financial approvals require self-set credentials",
          },
        },
        { status: 403 },
      );
    }
    const id = `u-${users.length + 1}`;
    users.push({
      id,
      name: body.name,
      email: null,
      mobile: body.mobile,
      status: "active",
      lastLoginAt: null,
      roleIds: body.roles,
      invitationId: null,
      invitationExpiresAt: null,
    });
    return HttpResponse.json(provisionUserResponseSchema.parse({ userId: id }), { status: 201 });
  }),

  http.post(`${API_BASE}${endpoints.resendInvitation(":id")}`, ({ params }) => {
    const row = users.find((candidate) => candidate.invitationId === params.id);
    const expiresAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    if (row) {
      row.invitationExpiresAt = expiresAt;
    }
    return HttpResponse.json(resendInvitationResponseSchema.parse({ expiresAt }));
  }),
  http.post(`${API_BASE}${endpoints.revokeInvitation(":id")}`, ({ params }) => {
    const row = users.find((candidate) => candidate.invitationId === params.id);
    if (row) {
      row.status = "suspended";
      row.invitationId = null;
      row.invitationExpiresAt = null;
    }
    return new HttpResponse(null, { status: 204 });
  }),

];
