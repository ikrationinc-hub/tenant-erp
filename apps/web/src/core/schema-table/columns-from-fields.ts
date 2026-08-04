import type { TableColumnsType } from "antd";
import type { FieldDefinitionsResponse } from "@ikration/contracts";
import { resolveFieldSections } from "../field-definitions/resolve-sections";
import type { EntityRow, SchemaTableColumnOverride } from "./types";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * Column definitions from field-definitions metadata (FE-4) - a flat grid
 * doesn't care about SchemaForm's section grouping, only about which
 * fields are visible and their label/order. `columns` lets a screen
 * override title/width/sortable/render per field for list-specific needs,
 * without ever hand-declaring a label (frontend rule 1).
 *
 * `masterLabels` (SchemaTable's own useMasterLabels) supplies a DEFAULT
 * render for any master/non-master-backed select field a caller hasn't
 * already overridden - a select field's stored value is the referenced
 * row's id, never its label, so without this every such column would show
 * a raw UUID. An explicit `render` in `overrides` always wins.
 */
export function columnsFromFieldDefinitions(
  schema: FieldDefinitionsResponse,
  overrides: SchemaTableColumnOverride[] = [],
  masterLabels: Map<string, Map<string, string>> = new Map(),
): TableColumnsType<EntityRow> {
  const overrideByFieldKey = new Map(overrides.map((override) => [override.fieldKey, override]));

  // resolveFieldSections already drops isVisible:false fields and flattens
  // the section grouping - a flat grid never cared about sections anyway.
  const fields = resolveFieldSections(schema).flatMap((section) => section.fields);

  return fields
    .filter((field) => !overrideByFieldKey.get(field.fieldKey)?.hidden)
    .map((field) => {
      const override = overrideByFieldKey.get(field.fieldKey);
      const master = field.dataType === "select" && field.optionsSource?.type === "master" ? field.optionsSource.master : undefined;
      const labels = master ? masterLabels.get(master) : undefined;
      const defaultRender = labels ? (value: unknown) => labels.get(asDisplayString(value)) ?? asDisplayString(value) : undefined;
      return {
        key: field.fieldKey,
        dataIndex: field.fieldKey,
        title: override?.title ?? field.label,
        sorter: override?.sortable ?? true,
        ...(override?.width !== undefined ? { width: override.width } : {}),
        ...(override?.render ? { render: override.render } : defaultRender ? { render: defaultRender } : {}),
      };
    });
}
