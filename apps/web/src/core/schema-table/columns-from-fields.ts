import type { TableColumnsType } from "antd";
import type { FieldDefinitionsResponse } from "@hyperion/contracts";
import { resolveFieldSections } from "../field-definitions/resolve-sections";
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

  // resolveFieldSections already drops isVisible:false fields and flattens
  // the section grouping - a flat grid never cared about sections anyway.
  const fields = resolveFieldSections(schema).flatMap((section) => section.fields);

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
