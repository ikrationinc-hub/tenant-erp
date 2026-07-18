import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { useController } from "react-hook-form";
import { Select, Typography } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString } from "./field-value-utils";
import { useFieldOptions } from "../use-field-options";

export function DropdownField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const { options, isLoading, parentValue, parentReady } = useFieldOptions(field, control);

  const dependsOn = field.optionsSource?.dependsOn;
  const previousParentValue = useRef(parentValue);

  useEffect(() => {
    if (!dependsOn) {
      return;
    }
    if (previousParentValue.current !== parentValue) {
      previousParentValue.current = parentValue;
      if (asString(rhf.value)) {
        rhf.onChange("");
      }
    }
    // rhf is a stable object from useController; including it would not add correctness here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentValue, dependsOn]);

  const currentValue = asString(rhf.value);
  const selectedLabel = options.find((option) => option.value === currentValue)?.label ?? currentValue;

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Text id={field.fieldKey}>{currentValue ? selectedLabel : "—"}</Typography.Text>
      ) : (
        <Select
          id={field.fieldKey}
          aria-label={field.label}
          style={{ width: "100%" }}
          value={currentValue || null}
          onChange={(value: string) => rhf.onChange(value)}
          onBlur={rhf.onBlur}
          options={options}
          loading={isLoading}
          disabled={Boolean(dependsOn) && !parentReady}
          allowClear
          placeholder={dependsOn && !parentReady ? "Select the parent field first" : undefined}
        />
      )}
    </FieldShell>
  );
}
