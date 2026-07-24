import type { ReactElement } from "react";
import dayjs from "dayjs";
import { DatePicker, Input, Select, Space } from "antd";
import type { EntityListState } from "./use-entity-list-state";
import type { SchemaTableFilter } from "./types";

const DATE_FORMAT = "YYYY-MM-DD";

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

function DateRangeFilterControl({
  filter,
  fromValue,
  toValue,
  onChangeFrom,
  onChangeTo,
}: {
  filter: SchemaTableFilter;
  fromValue: string | undefined;
  toValue: string | undefined;
  onChangeFrom: (value: string | undefined) => void;
  onChangeTo: (value: string | undefined) => void;
}): ReactElement {
  const from = fromValue ? dayjs(fromValue, DATE_FORMAT) : null;
  const to = toValue ? dayjs(toValue, DATE_FORMAT) : null;

  return (
    <DatePicker.RangePicker
      aria-label={filter.label}
      value={[from && from.isValid() ? from : null, to && to.isValid() ? to : null]}
      onChange={(dates) => {
        onChangeFrom(dates?.[0] ? dates[0].format(DATE_FORMAT) : undefined);
        onChangeTo(dates?.[1] ? dates[1].format(DATE_FORMAT) : undefined);
      }}
      format={DATE_FORMAT}
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
      {filters.map((filter) =>
        filter.type === "dateRange" ? (
          <DateRangeFilterControl
            key={filter.key}
            filter={filter}
            fromValue={state.filters[`${filter.key}From`]}
            toValue={state.filters[`${filter.key}To`]}
            onChangeFrom={(value) => onFilterChange(`${filter.key}From`, value)}
            onChangeTo={(value) => onFilterChange(`${filter.key}To`, value)}
          />
        ) : (
          <FilterControl
            key={filter.key}
            filter={filter}
            value={state.filters[filter.key]}
            onChange={(value) => onFilterChange(filter.key, value)}
          />
        ),
      )}
    </Space>
  );
}
