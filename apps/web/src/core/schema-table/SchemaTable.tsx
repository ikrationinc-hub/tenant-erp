import type { Key, ReactElement } from "react";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Skeleton, Space, Table, type TableColumnsType, type TableProps } from "antd";
import { fieldDefinitionsResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints } from "../api/endpoints";
import { usePermissions } from "../permissions/use-permissions";
import { columnsFromFieldDefinitions } from "./columns-from-fields";
import { useEntityListState } from "./use-entity-list-state";
import { useEntityList } from "./use-entity-list";
import { FilterBar } from "./FilterBar";
import type { EntityRow, SchemaTableAction, SchemaTableProps } from "./types";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function toSortField(field: Key | readonly Key[] | undefined): string | undefined {
  // `typeof x === "object"` (not Array.isArray) narrows cleanly here: Key
  // itself (string | number) is never an object, so this is exactly the
  // array branch - Array.isArray's built-in `arg is any[]` predicate would
  // otherwise widen `field[0]` to `any`.
  const first = typeof field === "object" ? field[0] : field;
  if (typeof first === "string") {
    return first;
  }
  return typeof first === "number" ? String(first) : undefined;
}

function toSortDir(order: "ascend" | "descend" | null | undefined): "asc" | "desc" | undefined {
  if (order === "ascend") {
    return "asc";
  }
  return order === "descend" ? "desc" : undefined;
}

/** Row actions gated by permission (frontend rule 4 - UX only, computed once here rather than a hook call per row/action). */
function buildActionsColumn(
  actions: SchemaTableAction[],
  permissions: Set<string>,
): TableColumnsType<EntityRow>[number] | undefined {
  if (actions.length === 0) {
    return undefined;
  }
  return {
    key: "__actions",
    title: "Actions",
    fixed: "right",
    width: Math.max(96, actions.length * 88),
    render: (_value: unknown, row: EntityRow) => {
      const visible = actions.filter((action) => {
        if (action.permission && !permissions.has(action.permission)) {
          return false;
        }
        return !action.isVisible || action.isVisible(row);
      });
      if (visible.length === 0) {
        return null;
      }
      return (
        <Space size="small">
          {visible.map((action) => (
            <Button key={action.key} type="link" danger={action.danger ?? false} onClick={() => action.onClick(row)}>
              {action.label}
            </Button>
          ))}
        </Space>
      );
    },
  };
}

/**
 * Generic grid over AntD Table (FE-4) - columns from field-definitions
 * metadata, rows from a server-paginated/sorted/filtered list endpoint.
 * State lives in the URL (use-entity-list-state.ts), so a filtered view is
 * shareable and survives a refresh.
 */
export function SchemaTable({
  module,
  entity,
  endpoint,
  columns,
  filters = [],
  actions = [],
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: SchemaTableProps): ReactElement {
  const filterKeys = useMemo(
    () => filters.flatMap((filter) => (filter.type === "dateRange" ? [`${filter.key}From`, `${filter.key}To`] : [filter.key])),
    [filters],
  );
  const { state, setPage, setPageSize, setSort, setSearch, setFilter } = useEntityListState(filterKeys);

  const schemaQuery = useQuery({
    queryKey: ["field-definitions", module, entity],
    queryFn: () =>
      apiFetch(endpoints.fieldDefinitions(module, entity), {}, { schema: fieldDefinitionsResponseSchema }),
  });
  const listQuery = useEntityList(endpoint, state);
  const { permissions } = usePermissions();

  if (schemaQuery.isLoading) {
    return <Skeleton active data-testid="schema-table-loading" />;
  }
  if (schemaQuery.isError || !schemaQuery.data) {
    return <Alert type="error" showIcon message="Could not load the column definitions" />;
  }
  if (listQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="Could not load records"
        description={listQuery.error instanceof Error ? listQuery.error.message : undefined}
      />
    );
  }

  const dataColumns = columnsFromFieldDefinitions(schemaQuery.data, columns);
  const actionsColumn = buildActionsColumn(actions, permissions);
  const tableColumns: TableColumnsType<EntityRow> = actionsColumn ? [...dataColumns, actionsColumn] : dataColumns;

  const handleChange: TableProps<EntityRow>["onChange"] = (pagination, _filters, sorter) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const nextSortBy = toSortField(single?.field);
    const nextSortDir = toSortDir(single?.order);

    // A sort change always resets to page 1 (setSort's own doing) - so a
    // pure pagination click must NOT also call setSort, or its unconditional
    // page reset would clobber the very page the user just clicked to.
    if (nextSortBy !== state.sortBy || nextSortDir !== state.sortDir) {
      setSort(nextSortBy, nextSortDir);
      return;
    }

    if (pagination.current !== undefined && pagination.current !== state.page) {
      setPage(pagination.current);
    }
    if (pagination.pageSize !== undefined && pagination.pageSize !== state.pageSize) {
      setPageSize(pagination.pageSize);
    }
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <FilterBar filters={filters} state={state} onSearch={setSearch} onFilterChange={setFilter} />
      <Table<EntityRow>
        rowKey="id"
        size="small"
        sticky
        scroll={{ x: "max-content" }}
        columns={tableColumns}
        dataSource={listQuery.data?.items ?? []}
        loading={listQuery.isFetching}
        onChange={handleChange}
        locale={{ emptyText: <Empty description="No records" /> }}
        pagination={{
          current: state.page,
          pageSize: state.pageSize,
          total: listQuery.data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: pageSizeOptions.map(String),
          showTotal: (total) => `${total} records`,
        }}
      />
    </Space>
  );
}
