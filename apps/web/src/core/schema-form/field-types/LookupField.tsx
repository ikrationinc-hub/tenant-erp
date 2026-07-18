import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import { Select, Typography } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString } from "./field-value-utils";
import { useFieldOptions } from "../use-field-options";
import { useDebouncedValue } from "../use-debounced-value";

/** Same as Dropdown, plus server-side search - "search and link records from another module" per the spec. */
export function LookupField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const { options, isLoading, parentValue, parentReady } = useFieldOptions(field, control, debouncedSearch);

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
          showSearch
          filterOption={false}
          value={currentValue || null}
          onChange={(value: string) => rhf.onChange(value)}
          onSearch={setSearchInput}
          onBlur={rhf.onBlur}
          options={options}
          loading={isLoading}
          disabled={Boolean(dependsOn) && !parentReady}
          allowClear
          notFoundContent={isLoading ? "Searching…" : "No matches"}
        />
      )}
    </FieldShell>
  );
}
