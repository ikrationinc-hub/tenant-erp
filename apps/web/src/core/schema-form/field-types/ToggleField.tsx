import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Switch, Tag } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asBoolean } from "./field-value-utils";

export function ToggleField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asBoolean(rhf.value);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Tag id={field.fieldKey} color={value ? "green" : "default"}>
          {value ? "Active" : "Inactive"}
        </Tag>
      ) : (
        <Switch id={field.fieldKey} aria-label={field.label} checked={value} onChange={rhf.onChange} />
      )}
    </FieldShell>
  );
}
