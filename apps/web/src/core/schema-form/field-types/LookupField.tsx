import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { useController } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { App, Drawer, Select } from "antd";
import type { FieldComponentProps } from "./types";
import { FieldShell } from "./FieldShell";
import { ReadOnlyValue } from "./ReadOnlyValue";
import { asString, asStringArray } from "./field-value-utils";
import { LOOKUP_CREATE_FORMS, NON_MASTER_CREATE_ENDPOINTS, useFieldOptions } from "../use-field-options";
import { useDebouncedValue } from "../use-debounced-value";
import { apiFetch } from "../../api/client";
import { SchemaForm } from "../SchemaForm";

const CREATE_OPTION_VALUE = "__schema_form_create_new__";

function labelFor(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * For a masterKey in LOOKUP_CREATE_FORMS (e.g. Supplier) - opens that
 * entity's own real create form instead of a single text box, since a
 * name alone can't satisfy its other required fields. Reuses SchemaForm
 * exactly like its own screen does (e.g. SupplierScreen.tsx's
 * CreateSupplierForm, which opens the same way - a right-side Drawer, not
 * a centered Modal, matching every other create/edit form in this app);
 * the sub-table editors (contacts/banks) that screen bolts on are
 * deliberately skipped here - both are optional on createSupplierSchema,
 * and a PO-entry quick-add only needs the record to exist, not to be
 * fully fleshed out.
 */
function LookupCreateDrawer({
  module,
  entity,
  endpoint,
  label,
  initialName,
  onCreated,
  onClose,
}: {
  module: string;
  entity: string;
  endpoint: string;
  label: string;
  initialName: string;
  onCreated: (id: string) => void;
  onClose: () => void;
}): ReactElement {
  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    const created = await apiFetch<{ id: string }>(endpoint, { method: "POST", body: values });
    onCreated(created.id);
  }

  return (
    <Drawer title={`New ${label}`} open onClose={onClose} width={560} destroyOnHidden>
      <SchemaForm module={module} entity={entity} mode="create" initialValues={{ name: initialName }} onSubmit={handleSubmit} />
    </Drawer>
  );
}

/**
 * The renderer for every select-type field (registry.ts maps both
 * "Dropdown" and "Lookup" here - they were two near-identical components
 * until this merge; Lookup was always a strict superset). Search is
 * always on: a master-backed source (optionsSource.type === "master")
 * filters server-side via the `search` query param (use-field-options.ts);
 * anything else (a static/enum list - pricing type, status, fiscal-year
 * month, ...) has no server round-trip to filter through, so `filterOption`
 * does the filtering client-side instead of shipping a search box that
 * silently does nothing.
 *
 * `allowCreate: true` (purchase/header's containerId and buyerId, or any
 * future field a company admin flags in Settings -> Field Definitions)
 * additionally offers "+ Add" when nothing matches. Three ways that can be
 * fulfilled, resolved by masterKey: a masterKey in LOOKUP_CREATE_FORMS
 * (e.g. suppliers) opens that entity's real create form in a modal
 * (LookupCreateModal below); a masterKey in NON_MASTER_CREATE_ENDPOINTS
 * (e.g. companies, branches) posts a single guessed field's worth of data
 * to that entity's own endpoint; anything else falls back to the generic
 * `/masters/${masterKey}` + `{code, name}`. Create is single-select only -
 * no field combines `multiple` with `allowCreate` today.
 */
export function LookupField({ field, control, readOnly }: FieldComponentProps): ReactElement {
  const { field: rhf, fieldState } = useController({ name: field.fieldKey, control });
  const { message } = App.useApp();
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const { options, isLoading, parentValue, parentReady } = useFieldOptions(field, control, debouncedSearch);
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [createModalName, setCreateModalName] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentValue, dependsOn]);

  const masterKey = field.optionsSource?.type === "master" ? (field.optionsSource.master ?? "") : "";
  const isMasterSource = masterKey.length > 0;
  const trimmedSearch = searchInput.trim();
  const createForm = LOOKUP_CREATE_FORMS[masterKey];
  const canOfferCreate =
    !field.multiple &&
    Boolean(field.allowCreate) &&
    isMasterSource &&
    trimmedSearch.length > 0 &&
    !options.some((option) => option.label.toLowerCase() === trimmedSearch.toLowerCase());

  const selectOptions = canOfferCreate
    ? [...options, { value: CREATE_OPTION_VALUE, label: `+ Add "${trimmedSearch}"` }]
    : options;

  const disabled = Boolean(dependsOn) && !parentReady;
  const placeholder = dependsOn && !parentReady ? "Select the parent field first" : undefined;
  const filterOption = isMasterSource
    ? false
    : (input: string, option?: { label?: string }): boolean =>
        (option?.label ?? "").toLowerCase().includes(input.toLowerCase());

  async function selectCreatedOption(id: string): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["field-options", masterKey] });
    rhf.onChange(id);
    setSearchInput("");
  }

  async function handleChange(value: string): Promise<void> {
    if (value !== CREATE_OPTION_VALUE) {
      rhf.onChange(value);
      return;
    }
    if (createForm) {
      setCreateModalName(trimmedSearch);
      return;
    }
    setIsCreating(true);
    try {
      const createConfig = NON_MASTER_CREATE_ENDPOINTS[masterKey];
      const endpoint = createConfig ? createConfig.endpoint : `/masters/${masterKey}`;
      const body = createConfig ? createConfig.buildPayload(trimmedSearch) : { code: trimmedSearch, name: trimmedSearch };
      const created = await apiFetch<{ id: string }>(endpoint, { method: "POST", body });
      await selectCreatedOption(created.id);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "Could not create this option");
    } finally {
      setIsCreating(false);
    }
  }

  if (field.multiple) {
    const currentValues = asStringArray(rhf.value);
    return (
      <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
        {readOnly ? (
          <ReadOnlyValue
            id={field.fieldKey}
            value={currentValues.length > 0 ? currentValues.map((value) => labelFor(options, value)).join(", ") : ""}
          />
        ) : (
          <Select
            id={field.fieldKey}
            aria-label={field.label}
            mode="multiple"
            style={{ width: "100%" }}
            showSearch
            filterOption={filterOption}
            value={currentValues}
            onChange={(values: string[]) => rhf.onChange(values)}
            onSearch={setSearchInput}
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
  const selectedLabel = options.find((option) => option.value === currentValue)?.label ?? currentValue;

  return (
    <FieldShell fieldKey={field.fieldKey} label={field.label} mandatory={field.isMandatory} error={fieldState.error?.message}>
      {readOnly ? (
        <ReadOnlyValue id={field.fieldKey} value={currentValue ? selectedLabel : ""} />
      ) : (
        <Select
          id={field.fieldKey}
          aria-label={field.label}
          style={{ width: "100%" }}
          showSearch
          filterOption={filterOption}
          value={currentValue || null}
          onChange={(value: string) => void handleChange(value)}
          onSearch={setSearchInput}
          onBlur={rhf.onBlur}
          options={selectOptions}
          loading={isLoading || isCreating}
          disabled={disabled}
          allowClear
          placeholder={placeholder}
          notFoundContent={isLoading ? "Searching…" : "No matches"}
        />
      )}
      {createForm && createModalName !== null && (
        <LookupCreateDrawer
          module={createForm.module}
          entity={createForm.entity}
          endpoint={createForm.endpoint}
          label={field.label}
          initialName={createModalName}
          onCreated={(id) => {
            void selectCreatedOption(id).then(() => setCreateModalName(null));
          }}
          onClose={() => setCreateModalName(null)}
        />
      )}
    </FieldShell>
  );
}
