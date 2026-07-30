import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { DatePicker, Select, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { useEntityList } from "../../core/schema-table/use-entity-list";
import { useEntityListState } from "../../core/schema-table/use-entity-list-state";
import type { EntityRow } from "../../core/schema-table/types";
import { INVENTORY_PATH, asDisplayString, resolvedLabel, useLabelMap, useMasterOptions } from "./shared";

const FILTER_KEYS = ["itemId", "warehouseId", "movementType", "movementDateFrom", "movementDateTo"] as const;

const MOVEMENT_TYPE_OPTIONS = [{ label: "Purchase Receipt", value: "purchase_receipt" }];

/**
 * FR-108's read surface, view 2: the raw append-only ledger (GET
 * /inventory/movements), newest first - every stock_movements row ever
 * written, never editable from here (there is no PATCH/DELETE - rule 8's
 * same principle: a correction is a new, offsetting movement). Quantity
 * is displayed exactly as the API returns it, signed by a leading "-" or
 * implied "+" - never parsed to a number (rule 3).
 */
export function InventoryMovementsScreen(): ReactElement | null {
  return (
    <Can permission="inventory.stock.read">
      <InventoryMovementsScreenContent />
    </Can>
  );
}

/** Belt-and-suspenders, same reasoning as InventoryBalancesScreen.tsx - the menu tree already gates real navigation here. */
function InventoryMovementsScreenContent(): ReactElement {
  const navigate = useNavigate();
  const { state, setPage, setPageSize, setFilter } = useEntityListState(FILTER_KEYS);
  const query = useEntityList(endpoints.inventoryMovements, state);

  const items = useMasterOptions(endpoints.masterOptions("items"));
  const warehouses = useMasterOptions(endpoints.masterOptions("warehouses"));
  const itemLabels = useLabelMap(items);
  const warehouseLabels = useLabelMap(warehouses);

  const rows = (query.data?.items ?? []) as EntityRow[];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Inventory — Stock Movements
        </Typography.Title>
        <Typography.Link onClick={() => void navigate(INVENTORY_PATH)}>View balances</Typography.Link>
      </Space>

      <Space wrap>
        <Select
          allowClear
          placeholder="Item"
          style={{ width: 220 }}
          options={items}
          value={state.filters.itemId ?? null}
          onChange={(value) => setFilter("itemId", value ?? undefined)}
        />
        <Select
          allowClear
          placeholder="Warehouse"
          style={{ width: 220 }}
          options={warehouses}
          value={state.filters.warehouseId ?? null}
          onChange={(value) => setFilter("warehouseId", value ?? undefined)}
        />
        <Select
          allowClear
          placeholder="Type"
          style={{ width: 180 }}
          options={MOVEMENT_TYPE_OPTIONS}
          value={state.filters.movementType ?? null}
          onChange={(value) => setFilter("movementType", value ?? undefined)}
        />
        <DatePicker.RangePicker
          value={
            state.filters.movementDateFrom && state.filters.movementDateTo
              ? [dayjs(state.filters.movementDateFrom), dayjs(state.filters.movementDateTo)]
              : null
          }
          onChange={(range) => {
            setFilter("movementDateFrom", range?.[0] ? range[0].format("YYYY-MM-DD") : undefined);
            setFilter("movementDateTo", range?.[1] ? range[1].format("YYYY-MM-DD") : undefined);
          }}
        />
      </Space>

      <Table<EntityRow>
        rowKey={(row) => asDisplayString(row.id)}
        loading={query.isLoading}
        dataSource={rows}
        pagination={{
          current: state.page,
          pageSize: state.pageSize,
          total: query.data?.total ?? 0,
          onChange: (page, pageSize) => {
            setPage(page);
            if (pageSize !== state.pageSize) {
              setPageSize(pageSize);
            }
          },
        }}
        columns={[
          { key: "movementDate", title: "Date", dataIndex: "movementDate" },
          { key: "itemId", title: "Item", render: (_v, row) => resolvedLabel(itemLabels, row.itemId) },
          { key: "warehouseId", title: "Warehouse", render: (_v, row) => resolvedLabel(warehouseLabels, row.warehouseId) },
          {
            key: "movementType",
            title: "Type",
            render: (_v, row) => <Tag color="green">{asDisplayString(row.movementType)}</Tag>,
          },
          {
            key: "quantity",
            title: "Quantity",
            render: (_v, row) => {
              const quantity = asDisplayString(row.quantity);
              return quantity.startsWith("-") ? quantity : `+${quantity}`;
            },
          },
          {
            key: "source",
            title: "Source Document",
            render: (_v, row) =>
              row.sourcePurchaseNumber ? (
                <Typography.Link href={`/purchase/orders/${asDisplayString(row.sourcePurchaseId)}`}>
                  {asDisplayString(row.sourcePurchaseNumber)}
                </Typography.Link>
              ) : (
                "—"
              ),
          },
        ]}
      />
    </Space>
  );
}
