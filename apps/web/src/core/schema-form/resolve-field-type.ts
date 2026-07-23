import type { FieldDataType, FieldDefinition, FieldType } from "@hyperion/contracts";

/** The real field-engine only knows dataType, not this widget-level enum - a sensible default per data type, used whenever a field arrives without an explicit fieldType. */
const DEFAULT_FIELD_TYPE_BY_DATA_TYPE: Record<FieldDataType, FieldType> = {
  text: "Textbox",
  textarea: "TextArea",
  number: "Decimal",
  decimal: "Decimal",
  boolean: "Toggle",
  date: "DatePicker",
  datetime: "DatePicker",
  select: "Dropdown",
};

export function resolveFieldType(field: FieldDefinition): FieldType {
  return field.fieldType ?? DEFAULT_FIELD_TYPE_BY_DATA_TYPE[field.dataType];
}
