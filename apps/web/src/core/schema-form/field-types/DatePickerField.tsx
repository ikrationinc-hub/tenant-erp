import type { ReactElement } from "react";
import { useController } from "react-hook-form";
import { DatePicker, Typography } from "antd";
import dayjs from "dayjs";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString } from "./field-value-utils";

const DATE_FORMAT = "YYYY-MM-DD";

/** Value is always the ISO date string, never a Date/dayjs object in form state - dayjs only mediates the widget itself. */
export function DatePickerField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const value = asString(rhf.value);
  const parsed = value ? dayjs(value, DATE_FORMAT) : null;

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Text id={field.fieldKey}>{value || "—"}</Typography.Text>
      ) : (
        <DatePicker
          id={field.fieldKey}
          style={{ width: "100%" }}
          value={parsed && parsed.isValid() ? parsed : null}
          onChange={(date) => rhf.onChange(date ? date.format(DATE_FORMAT) : "")}
          onBlur={rhf.onBlur}
          format={DATE_FORMAT}
        />
      )}
    </FieldShell>
  );
}
