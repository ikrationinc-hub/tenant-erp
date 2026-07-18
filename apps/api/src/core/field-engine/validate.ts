import { ValidationError } from "../../common/errors/index.js";
import type { EffectiveField } from "./types.js";

export interface FieldValidationIssue {
  fieldKey: string;
  message: string;
}

/**
 * Not a real business endpoint's validator (purchase.po has no routes
 * yet) - a generic, reusable check any future module's write endpoint
 * calls against its own resolved field list, so "is this field
 * mandatory" is answered once, here, from field_definitions' merged
 * result, instead of re-implemented per module. A field the resolved
 * list says is NOT visible/editable is skipped entirely: a hidden
 * mandatory field can't be filled in by whoever's submitting this data,
 * so requiring it would be a trap, not a validation rule.
 */
export function checkAgainstFieldDefinitions(
  fields: EffectiveField[],
  data: Record<string, unknown>,
): FieldValidationIssue[] {
  const issues: FieldValidationIssue[] = [];

  for (const field of fields) {
    if (!field.isMandatory || !field.isVisible || !field.isEditable) {
      continue;
    }
    const value = data[field.fieldKey];
    if (value === undefined || value === null || value === "") {
      issues.push({ fieldKey: field.fieldKey, message: `${field.label} is required` });
    }
  }

  return issues;
}

export function assertValidAgainstFieldDefinitions(
  fields: EffectiveField[],
  data: Record<string, unknown>,
): void {
  const issues = checkAgainstFieldDefinitions(fields, data);
  if (issues.length > 0) {
    throw new ValidationError("One or more required fields are missing", { issues });
  }
}
