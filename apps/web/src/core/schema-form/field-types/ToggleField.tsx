import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Switch } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { StatusTag } from "../../status-tag/StatusTag";
import { semantic, slate } from "../../../theme/palette";
import { asBoolean } from "./field-value-utils";

const TOGGLE_COLORS: Record<string, string> = { active: semantic.success, inactive: slate[400] };

export function ToggleField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asBoolean(rhf.value);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <StatusTag id={field.fieldKey} value={value ? "active" : "inactive"} colorMap={TOGGLE_COLORS} />
      ) : (
        <Switch id={field.fieldKey} aria-label={field.label} checked={value} onChange={rhf.onChange} />
      )}
    </FieldShell>
  );
}
