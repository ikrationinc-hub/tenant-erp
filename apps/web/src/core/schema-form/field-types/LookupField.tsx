import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Select, Typography } from "antd";
import type { MasterOption } from "@ikration/contracts";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { asString } from "./field-value-utils";
import { useFieldOptions } from "../use-field-options";
import { useDebouncedValue } from "../use-debounced-value";
import { apiFetch } from "../../api/client";

const CREATE_OPTION_VALUE = "__schema_form_create_new__";

/** Prompt 21 item 5: a Lookup field with `allowCreate: true` (currently only purchase/header's containerId) lets the user add a new master row inline instead of requiring pre-registration - container numbers are too numerous to pre-register. Posts to the bare masters collection endpoint (`/masters/${masterKey}`, matching MasterScreen.tsx's own create call), same code/name convention seed-dev-core.ts already uses for containers (the number IS both). */
export function LookupField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const { options, isLoading, parentValue, parentReady } = useFieldOptions(field, control, debouncedSearch);
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);

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

  const masterKey = field.optionsSource?.type === "master" ? (field.optionsSource.master ?? "") : "";
  const trimmedSearch = searchInput.trim();
  const canOfferCreate =
    Boolean(field.allowCreate) &&
    masterKey.length > 0 &&
    trimmedSearch.length > 0 &&
    !options.some((option) => option.label.toLowerCase() === trimmedSearch.toLowerCase());

  const selectOptions = canOfferCreate
    ? [...options, { value: CREATE_OPTION_VALUE, label: `+ Add "${trimmedSearch}"` }]
    : options;

  async function handleChange(value: string): Promise<void> {
    if (value !== CREATE_OPTION_VALUE) {
      rhf.onChange(value);
      return;
    }
    setIsCreating(true);
    try {
      const created = await apiFetch<MasterOption & { id: string }>(`/masters/${masterKey}`, {
        method: "POST",
        body: { code: trimmedSearch, name: trimmedSearch },
      });
      await queryClient.invalidateQueries({ queryKey: ["field-options", masterKey] });
      rhf.onChange(created.id);
      setSearchInput("");
    } finally {
      setIsCreating(false);
    }
  }

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
          onChange={(value: string) => void handleChange(value)}
          onSearch={setSearchInput}
          onBlur={rhf.onBlur}
          options={selectOptions}
          loading={isLoading || isCreating}
          disabled={Boolean(dependsOn) && !parentReady}
          allowClear
          notFoundContent={isLoading ? "Searching…" : "No matches"}
        />
      )}
    </FieldShell>
  );
}
