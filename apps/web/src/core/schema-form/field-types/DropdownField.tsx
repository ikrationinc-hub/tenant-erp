import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { useController } from "react-hook-form";
import { Select, Typography } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString, asStringArray } from "./field-value-utils";
import { useFieldOptions } from "../use-field-options";

function labelFor(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

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
      const hasValue = field.multiple ? asStringArray(rhf.value).length > 0 : Boolean(asString(rhf.value));
      if (hasValue) {
        rhf.onChange(field.multiple ? [] : "");
      }
    }
    // rhf is a stable object from useController; including it would not add correctness here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentValue, dependsOn]);

  const disabled = Boolean(dependsOn) && !parentReady;
  const placeholder = dependsOn && !parentReady ? "Select the parent field first" : undefined;

  if (field.multiple) {
    const currentValues = asStringArray(rhf.value);
    return (
      <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
        {readOnly ? (
          <Typography.Text id={field.fieldKey}>
            {currentValues.length > 0 ? currentValues.map((value) => labelFor(options, value)).join(", ") : "—"}
          </Typography.Text>
        ) : (
          <Select
            id={field.fieldKey}
            aria-label={field.label}
            mode="multiple"
            style={{ width: "100%" }}
            value={currentValues}
            onChange={(values: string[]) => rhf.onChange(values)}
            onBlur={rhf.onBlur}
            options={options}
            loading={isLoading}
            disabled={disabled}
            allowClear
            placeholder={placeholder}
          />
        )}
      </FieldShell>
    );
  }

  const currentValue = asString(rhf.value);

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <Typography.Text id={field.fieldKey}>{currentValue ? labelFor(options, currentValue) : "—"}</Typography.Text>
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
          disabled={disabled}
          allowClear
          placeholder={placeholder}
        />
      )}
    </FieldShell>
  );
}
