import type { ReactElement } from "react";
import dayjs from "dayjs";
import { Button, ConfigProvider, DatePicker, Input, Select } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import type { EntityListState } from "./use-entity-list-state";
import type { SchemaTableFilter } from "./types";
import { slate } from "../../theme/palette";

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
        // Remounts when `value` is reset externally (e.g. "Clear filters")
        // - onChange isn't wired per-keystroke here (see onBlur/onPressEnter
        // below), so this is an uncontrolled input and needs a key change
        // to pick up a value it didn't set itself.
        key={value ?? ""}
        placeholder={filter.label}
        aria-label={filter.label}
        defaultValue={value}
        onPressEnter={(event) => onChange(event.currentTarget.value || undefined)}
        onBlur={(event) => onChange(event.currentTarget.value || undefined)}
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
  onClear,
}: {
  filters: SchemaTableFilter[];
  state: EntityListState;
  onSearch: (value: string | undefined) => void;
  onFilterChange: (key: string, value: string | undefined) => void;
  onClear: () => void;
}): ReactElement {
  const hasActiveFilters = state.search !== undefined || Object.keys(state.filters).length > 0;

  return (
    // An empty control (pale border on white, inside a bar that's already
    // white-on-white) read as decorative, not interactive. A theme-token
    // override - not a CSS class override - because AntD generates each
    // component's own background/placeholder/icon styling from these
    // tokens (via cssinjs) rather than reading a plain CSS rule, so this
    // is the one override guaranteed to win regardless of AntD's internal
    // selector specificity. Scoped to just this bar, not app-wide (a
    // SchemaForm field on a white Card should stay white) - same pattern
    // SchemaForm.tsx uses per-section for componentSize="large".
    <ConfigProvider
      theme={{
        token: {
          colorBgContainer: slate.bg,
          colorTextPlaceholder: slate[600],
          colorTextQuaternary: slate[600],
        },
      }}
    >
      <div className="filter-bar-row">
        <Input.Search
          // See FilterControl's text branch - same uncontrolled-input/key trick.
          key={state.search ?? ""}
          placeholder="Search"
          aria-label="Search"
          defaultValue={state.search}
          onSearch={(value) => onSearch(value || undefined)}
          allowClear
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
        {hasActiveFilters && (
          <Button className="filter-bar-clear" type="link" icon={<CloseCircleOutlined />} onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </ConfigProvider>
  );
}
