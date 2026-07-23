import type { TableColumnsType } from "antd";
import type { FieldDefinitionsResponse } from "@hyperion/contracts";
import type { EntityRow, SchemaTableColumnOverride } from "./types";

/**
 * Column definitions from field-definitions metadata (FE-4) - a flat grid
 * doesn't care about SchemaForm's section grouping, only about which
 * fields are visible and their label/order. `columns` lets a screen
 * override title/width/sortable/render per field for list-specific needs,
 * without ever hand-declaring a label (frontend rule 1).
 */
export function columnsFromFieldDefinitions(
  schema: FieldDefinitionsResponse,
  overrides: SchemaTableColumnOverride[] = [],
): TableColumnsType<EntityRow> {
  const overrideByFieldKey = new Map(overrides.map((override) => [override.fieldKey, override]));

  // No `isVisible` filter here: per field-definitions.ts, a field the
  // caller can't view is omitted from the response entirely (not
  // present-but-flagged) - every field that arrives has already passed
  // that gate server-side (frontend rule 4).
  const fields = schema.sections
    .flatMap((section) => section.fields)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return fields.map((field) => {
    const override = overrideByFieldKey.get(field.fieldKey);
    return {
      key: field.fieldKey,
      dataIndex: field.fieldKey,
      title: override?.title ?? field.label,
      sorter: override?.sortable ?? true,
      ...(override?.width !== undefined ? { width: override.width } : {}),
      ...(override?.render ? { render: override.render } : {}),
    };
  });
}
