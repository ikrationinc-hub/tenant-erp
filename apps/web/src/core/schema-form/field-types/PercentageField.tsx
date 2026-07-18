import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Typography } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { NumericStringInput } from "./NumericStringInput";
import { asString } from "./field-value-utils";

export function PercentageField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asString(rhf.value);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Text id={field.fieldKey}>{value ? `${value}%` : "—"}</Typography.Text>
      ) : (
        <NumericStringInput
          id={field.fieldKey}
          ariaLabel={field.label}
          value={value}
          onChange={rhf.onChange}
          onBlur={rhf.onBlur}
          suffix="%"
        />
      )}
    </FieldShell>
  );
}
