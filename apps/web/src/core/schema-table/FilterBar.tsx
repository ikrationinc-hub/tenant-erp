import type { ReactElement } from "react";
import { Input, Select, Space } from "antd";
import type { EntityListState } from "./use-entity-list-state";
import type { SchemaTableFilter } from "./types";

function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: SchemaTableFilter;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}): ReactElement {
  if (filter.type === "text") {
    return (
      <Input
        placeholder={filter.label}
        aria-label={filter.label}
        defaultValue={value}
        onPressEnter={(event) => onChange(event.currentTarget.value || undefined)}
        onBlur={(event) => onChange(event.currentTarget.value || undefined)}
        style={{ width: 180 }}
      />
    );
  }

  const options =
    filter.type === "boolean"
      ? [
          { label: "Yes", value: "true" },
          { label: "No", value: "false" },
        ]
      : (filter.options ?? []);

  return (
    <Select
      placeholder={filter.label}
      aria-label={filter.label}
      value={value ?? null}
      onChange={(next: string) => onChange(next)}
      onClear={() => onChange(undefined)}
      allowClear
      options={options}
      style={{ width: 180 }}
    />
  );
}

export function FilterBar({
  filters,
  state,
  onSearch,
  onFilterChange,
}: {
  filters: SchemaTableFilter[];
  state: EntityListState;
  onSearch: (value: string | undefined) => void;
  onFilterChange: (key: string, value: string | undefined) => void;
}): ReactElement {
  return (
    <Space wrap size="small">
      <Input.Search
        placeholder="Search"
        aria-label="Search"
        defaultValue={state.search}
        onSearch={(value) => onSearch(value || undefined)}
        allowClear
        style={{ width: 240 }}
      />
      {filters.map((filter) => (
        <FilterControl
          key={filter.key}
          filter={filter}
          value={state.filters[filter.key]}
          onChange={(value) => onFilterChange(filter.key, value)}
        />
      ))}
    </Space>
  );
}
