import type { ReactElement } from "react";
import type { TableColumnsType } from "antd";
import type { SortOrder } from "antd/es/table/interface";
import { CaretDownFilled, CaretUpFilled } from "@ant-design/icons";
import type { FieldDefinitionsResponse } from "@ikration/contracts";
import { resolveFieldSections } from "../field-definitions/resolve-sections";
import type { EntityRow, SchemaTableColumnOverride } from "./types";
import { slate, steelCobalt } from "../../theme/palette";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Trading-terminal convention: numbers and dates render in a monospaced, tabular-figure font so digits line up down a column. Purely presentational - carries no semantic meaning and is never read by validation or the API. */
const NUMERIC_DATA_TYPES = new Set(["number", "decimal", "date", "datetime"]);

/**
 * AntD reads `sortIcon` per COLUMN (`column.sortIcon` in its own
 * useSorter hook), not as a `<Table>`-level prop - a table-wide default
 * doesn't exist, so every sortable column gets this explicitly here,
 * the one place they're all built. Its own default sorter icon IS this
 * same stacked caret pair at slate-400, so the only actual change is the
 * rest-state color: slate-600, a full step darker, so it reads clearly on
 * a column nobody has sorted yet; the active direction picks up the app's
 * accent color.
 */
function SortIcon({ sortOrder }: { sortOrder?: SortOrder }): ReactElement {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", marginLeft: 5, lineHeight: 0 }}>
      <CaretUpFilled style={{ fontSize: 11, color: sortOrder === "ascend" ? steelCobalt.base : slate[600] }} />
      <CaretDownFilled style={{ fontSize: 11, marginTop: -3, color: sortOrder === "descend" ? steelCobalt.base : slate[600] }} />
    </span>
  );
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
        ...((override?.monospace ?? NUMERIC_DATA_TYPES.has(field.dataType)) ? { className: "num" } : {}),
        ...(override?.width !== undefined ? { width: override.width } : {}),
        ...(override?.render ? { render: override.render } : defaultRender ? { render: defaultRender } : {}),
      };
    });
}
