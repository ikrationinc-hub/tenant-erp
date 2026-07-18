import type { FieldValidationRules } from "../../database/tenant/schema.js";

export type { FieldValidationRules } from "../../database/tenant/schema.js";

export type FieldDataType =
  | "text"
  | "textarea"
  | "number"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "select";

/**
 * The code-declared baseline for a Tier 2 field (core/field-engine/
 * defaults.ts) - what a field looks like before any company has
 * overridden anything. `fieldKey`/`dataType`/`tier` are exactly the
 * properties a company override can never touch (CLAUDE.md: "data_type is
 * NEVER overridable"; field_key is the real column identifier, immutable
 * by construction since it's never part of the PATCH schema at all).
 */
export interface FieldDefault {
  module: string;
  entity: string;
  fieldKey: string;
  label: string;
  dataType: FieldDataType;
  isVisible: boolean;
  isMandatory: boolean;
  isEditable: boolean;
  defaultValue?: string;
  optionsSource?: string;
  validationJson?: FieldValidationRules;
  sortOrder: number;
  isSystem: boolean;
}

/**
 * What core/field-engine/resolve.ts actually returns: a FieldDefault's
 * shape, further narrowed by the requesting user's RBAC field
 * permissions (core/rbac) - `isVisible`/`isEditable` here are the FINAL,
 * already-intersected values a form can trust directly, not just the
 * company-level override.
 */
export interface EffectiveField {
  id: string | undefined;
  module: string;
  entity: string;
  fieldKey: string;
  tier: 2;
  label: string;
  dataType: FieldDataType;
  isVisible: boolean;
  isMandatory: boolean;
  isEditable: boolean;
  defaultValue: string | undefined;
  optionsSource: string | undefined;
  validationJson: FieldValidationRules | undefined;
  sortOrder: number;
  isSystem: boolean;
}
