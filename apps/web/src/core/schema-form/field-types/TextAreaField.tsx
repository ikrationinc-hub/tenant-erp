import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { Input, Typography } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString } from "./field-value-utils";

export function TextAreaField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asString(rhf.value);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Paragraph id={field.fieldKey} style={{ marginBottom: 0 }}>
          {value || "—"}
        </Typography.Paragraph>
      ) : (
        <Input.TextArea
          id={field.fieldKey}
          value={value}
          onChange={(event) => rhf.onChange(event.target.value)}
          onBlur={rhf.onBlur}
          rows={3}
        />
      )}
    </FieldShell>
  );
}
