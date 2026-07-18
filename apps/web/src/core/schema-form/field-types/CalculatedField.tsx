import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Typography } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString } from "./field-value-utils";

/** Always read-only: displays what the server computed, never recomputed client-side (frontend rule 3). */
export function CalculatedField({ field, control }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asString(rhf.value);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={false} error={fieldState.error?.message}>
      <Typography.Text id={field.fieldKey} italic type="secondary">
        {value || "—"}
      </Typography.Text>
    </FieldShell>
  );
}
