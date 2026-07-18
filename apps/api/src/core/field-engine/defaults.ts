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
  {
    module: "users",
    entity: "user",
    fieldKey: "name",
    label: "Full Name",
    dataType: "text",
    isVisible: true,
    isMandatory: true,
    isEditable: true,
    sortOrder: 0,
    isSystem: false,
  },
  {
    module: "users",
    entity: "user",
    fieldKey: "email",
    label: "Email",
    dataType: "text",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    sortOrder: 1,
    // A login identifier - see docs/adr/0006 on why email/mobile are both
    // nullable at the DB level, but whichever one a user has must stay
    // visible and reachable.
    isSystem: true,
    validationJson: { pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
  },
  {
    module: "users",
    entity: "user",
    fieldKey: "mobile",
    label: "Mobile",
    dataType: "text",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    sortOrder: 2,
    isSystem: false,
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
];

export function getFieldDefaults(module: string, entity: string): FieldDefault[] {
  return FIELD_DEFAULTS.filter((field) => field.module === module && field.entity === entity);
}
