import { ALL_MASTER_FIELD_DEFAULTS } from "../masters/registry.js";
import type { FieldDefault } from "./types.js";

/**
 * The single source of truth for every Tier 2 field this build knows
 * about - core/provisioning/seed-field-definitions.ts materializes one
 * field_definitions row per entry here for every company, and
 * core/field-engine/resolve.ts falls back to an entry here directly for
 * any tenant that hasn't been re-provisioned since an entry was added.
 * Adding a new configurable field to a module means adding it here, not
 * hand-writing a migration or a seed script.
 *
 * "purchase.po"'s Additional Cost fields are docs/spec/Purchase-V2.md
 * section G verbatim - Freight/Insurance/Customs are fixed-name Tier 2
 * (a real column, but nothing says the LABEL is configurable), and the
 * three "Other Charges" fields are explicitly called out in the spec as
 * "the reference case for the field engine": a real typed column with a
 * user-overridable label, nothing else. Renaming "Other Charges" to
 * "Clearing Charges" is exactly what this module exists to prove.
 */
export const FIELD_DEFAULTS: FieldDefault[] = [
  // FE-5.5's UserManagementScreen list columns - read-only (isEditable:
  // false everywhere): this entity's actual mutations go through the
  // dedicated suspend/reactivate/set-roles/invite/provision endpoints
  // below, never a generic PATCH on the field values themselves.
  {
    module: "users",
    entity: "user",
    fieldKey: "name",
    label: "Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: false,
    sortOrder: 0,
    isSystem: true,
  },
  {
    module: "users",
    entity: "user",
    fieldKey: "email",
    label: "Email",
    dataType: "text",
    isVisible: true,
    isMandatory: false,
    isEditable: false,
    sortOrder: 1,
    // A login identifier - see docs/adr/0006 on why email/mobile are both
    // nullable at the DB level, but whichever one a user has must stay
    // visible and reachable.
    isSystem: true,
  },
  {
    module: "users",
    entity: "user",
    fieldKey: "mobile",
    label: "Mobile",
    dataType: "text",
    isVisible: true,
    isMandatory: false,
    isEditable: false,
    sortOrder: 2,
    isSystem: true,
  },
  {
    module: "users",
    entity: "user",
    fieldKey: "status",
    label: "Status",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: false,
    sortOrder: 3,
    isSystem: true,
  },
  {
    module: "users",
    entity: "user",
    fieldKey: "lastLoginAt",
    label: "Last Login",
    dataType: "datetime",
    isVisible: true,
    isMandatory: false,
    isEditable: false,
    sortOrder: 4,
    isSystem: true,
  },
  // Mirrors users.validator.ts's inviteUserSchema field-for-field (task
  // item 8) - no password field, admins never set passwords (BE-7,
  // docs/adr/0006-user-onboarding.md).
  {
    module: "users",
    entity: "invite",
    fieldKey: "name",
    label: "Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: false,
  },
  {
    module: "users",
    entity: "invite",
    fieldKey: "email",
    label: "Email",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 1,
    isSystem: false,
    validationJson: { pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
  },
  {
    module: "users",
    entity: "invite",
    fieldKey: "mobile",
    label: "Mobile",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 2,
    isSystem: false,
  },
  {
    module: "users",
    entity: "invite",
    fieldKey: "roles",
    label: "Roles",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 3,
    isSystem: false,
    multiple: true,
    optionsSource: "roles",
  },
  // Mirrors provisionUserSchema field-for-field - the ops-staff exception
  // path (BE-7): a temp password, never an email.
  {
    module: "users",
    entity: "provision",
    fieldKey: "name",
    label: "Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: false,
  },
  {
    module: "users",
    entity: "provision",
    fieldKey: "mobile",
    label: "Mobile",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 1,
    isSystem: false,
  },
  {
    module: "users",
    entity: "provision",
    fieldKey: "tempPassword",
    label: "Temporary Password",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 2,
    isSystem: false,
  },
  {
    module: "users",
    entity: "provision",
    fieldKey: "roles",
    label: "Roles",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 3,
    isSystem: false,
    multiple: true,
    optionsSource: "roles",
  },
  // PUT /api/v1/users/:id/roles's form - the full desired set (task item
  // 7), so `isMandatory: false` deliberately allows saving an empty array
  // (revoking every role from a user is a valid, if unusual, edit).
  {
    module: "users",
    entity: "edit-roles",
    fieldKey: "roleIds",
    label: "Roles",
    dataType: "select",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    sortOrder: 0,
    isSystem: false,
    multiple: true,
    optionsSource: "roles",
  },
  {
    module: "admin",
    entity: "company",
    fieldKey: "name",
    label: "Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: true,
  },
  {
    module: "admin",
    entity: "company",
    fieldKey: "countryId",
    label: "Country",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 1,
    isSystem: false,
    optionsSource: "masters:countries",
  },
  {
    module: "admin",
    entity: "company",
    fieldKey: "currencyId",
    label: "Currency",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 2,
    isSystem: false,
    optionsSource: "masters:currencies",
  },
  {
    // No optionsSource: a fixed 1-12 static list, same gap as masters'
    // itemType below - the real field-engine's FieldDefault.optionsSource
    // convention only covers "masters:<x>"/"roles" today, not an inline
    // static option list (packages/contracts' richer `{type:"static",...}"
    // shape is an apps/web dev-fixture-only convention, not something this
    // backend emits yet).
    module: "admin",
    entity: "company",
    fieldKey: "fiscalYearStartMonth",
    label: "Fiscal Year Start Month",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 3,
    isSystem: false,
  },
  {
    module: "admin",
    entity: "company",
    fieldKey: "timezone",
    label: "Timezone",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 4,
    isSystem: false,
  },
  {
    module: "admin",
    entity: "company",
    fieldKey: "taxRegistrationNo",
    label: "Tax Registration No.",
    dataType: "text",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    sortOrder: 5,
    isSystem: false,
  },
  {
    module: "admin",
    entity: "company",
    fieldKey: "status",
    label: "Status",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 6,
    isSystem: false,
  },
  {
    module: "admin",
    entity: "branch",
    fieldKey: "name",
    label: "Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: true,
  },
  {
    module: "admin",
    entity: "branch",
    fieldKey: "code",
    label: "Code",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 1,
    isSystem: true,
  },
  {
    module: "admin",
    entity: "branch",
    fieldKey: "status",
    label: "Status",
    dataType: "select",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 2,
    isSystem: false,
    // company_id is deliberately NOT a field here - the backend injects it
    // from the request's tenant scope (backend rule 2), never a form field.
  },
  {
    module: "admin",
    entity: "role",
    fieldKey: "name",
    label: "Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: true,
  },
  {
    module: "purchase",
    entity: "po",
    fieldKey: "freight",
    label: "Freight",
    dataType: "decimal",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: "0",
    sortOrder: 0,
    isSystem: false,
  },
  {
    module: "purchase",
    entity: "po",
    fieldKey: "insurance",
    label: "Insurance",
    dataType: "decimal",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: "0",
    sortOrder: 1,
    isSystem: false,
  },
  {
    module: "purchase",
    entity: "po",
    fieldKey: "customs",
    label: "Customs",
    dataType: "decimal",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: "0",
    sortOrder: 2,
    isSystem: false,
  },
  {
    module: "purchase",
    entity: "po",
    fieldKey: "otherCharges",
    label: "Other Charges",
    dataType: "decimal",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: "0",
    sortOrder: 3,
    isSystem: false,
  },
  {
    module: "purchase",
    entity: "po",
    fieldKey: "otherCharges2",
    label: "Other Charges 2",
    dataType: "decimal",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: "0",
    sortOrder: 4,
    isSystem: false,
  },
  {
    module: "purchase",
    entity: "po",
    fieldKey: "otherCharges3",
    label: "Other Charges 3",
    dataType: "decimal",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: "0",
    sortOrder: 5,
    isSystem: false,
  },
  // FE-7's field-permission demo needs a real, resolvable field to prove
  // "revoke can_view -> the very next GET /field-definitions/purchase/
  // pricing for that role no longer shows it" (this task's own acceptance
  // test) - purchase_pricing.purchaseRateUsd (schema.ts) is that field.
  // Declaring it here doesn't make it Tier-2/company-overridable in the
  // CLAUDE.md sense (it's still a fixed, typed rate column the purchase
  // module writes directly) - it only enrolls it in the field-engine's
  // resolve pipeline, which is what field_permissions' view/edit narrowing
  // (core/rbac/resolve.ts) needs to have anything to narrow.
  {
    module: "purchase",
    entity: "pricing",
    fieldKey: "purchaseRateUsd",
    label: "Purchase Rate (USD)",
    dataType: "decimal",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: true,
  },
  // Every masters.<entity> Tier-2 field (code/name/isActive + each
  // master's own extras, e.g. cities.countryId) - generated from
  // core/masters/registry.ts's MASTER_MODULES rather than hand-duplicated
  // here, so a 16th master needs zero changes to this file.
  ...ALL_MASTER_FIELD_DEFAULTS,
];

export function getFieldDefaults(module: string, entity: string): FieldDefault[] {
  return FIELD_DEFAULTS.filter((field) => field.module === module && field.entity === entity);
}
