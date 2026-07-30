import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Select, Space, Table, Typography } from "antd";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { useEntityList } from "../../core/schema-table/use-entity-list";
import { useEntityListState } from "../../core/schema-table/use-entity-list-state";
import type { EntityRow } from "../../core/schema-table/types";
import { MovementHistoryModal } from "./MovementHistoryModal";
import { INVENTORY_MOVEMENTS_PATH, asDisplayString, resolvedLabel, useLabelMap, useMasterOptions } from "./shared";

const FILTER_KEYS = ["itemId", "warehouseId"] as const;

/**
 * FR-108's read surface, view 1: current quantity per item+warehouse,
 * DERIVED server-side by summing stock_movements (GET
 * /inventory/balances) - there is no mutable balance column anywhere to
 * render instead. Quantities are displayed exactly as the API returns
 * them (a numeric string) - never parseFloat'd (rule 3).
 */
export function InventoryBalancesScreen(): ReactElement | null {
  return (
    <Can permission="inventory.stock.read">
      <InventoryBalancesScreenContent />
    </Can>
  );
}

/** The menu tree already keeps an unauthorized user from ever navigating here (DynamicRoutes never resolves a path outside their own resolved menu) - the <Can> wrapper above is belt-and-suspenders, same as modules/admin/FieldDefinitionsScreen.tsx. */
function InventoryBalancesScreenContent(): ReactElement {
  const navigate = useNavigate();
  const { state, setPage, setPageSize, setFilter } = useEntityListState(FILTER_KEYS);
  const query = useEntityList(endpoints.inventoryBalances, state);
  const [selected, setSelected] = useState<{ itemId: string; warehouseId: string } | null>(null);

  const items = useMasterOptions(endpoints.masterOptions("items"));
  const warehouses = useMasterOptions(endpoints.masterOptions("warehouses"));
  const grades = useMasterOptions(endpoints.masterOptions("item-grades"));
  const uoms = useMasterOptions(endpoints.masterOptions("uom"));
  const itemLabels = useLabelMap(items);
  const warehouseLabels = useLabelMap(warehouses);
  const gradeLabels = useLabelMap(grades);
  const uomLabels = useLabelMap(uoms);

  const rows = (query.data?.items ?? []) as EntityRow[];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Inventory — Stock Balances
        </Typography.Title>
        <Typography.Link onClick={() => void navigate(INVENTORY_MOVEMENTS_PATH)}>View all movements</Typography.Link>
      </Space>

      <Space>
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
      </Space>

      <Table<EntityRow>
        rowKey={(row) => `${asDisplayString(row.itemId)}::${asDisplayString(row.gradeId)}::${asDisplayString(row.warehouseId)}`}
        loading={query.isLoading}
        dataSource={rows}
        onRow={(row) => ({
          onClick: () => setSelected({ itemId: asDisplayString(row.itemId), warehouseId: asDisplayString(row.warehouseId) }),
          style: { cursor: "pointer" },
        })}
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
          { key: "itemId", title: "Item", render: (_v, row) => resolvedLabel(itemLabels, row.itemId) },
          { key: "gradeId", title: "Grade", render: (_v, row) => resolvedLabel(gradeLabels, row.gradeId) },
          { key: "warehouseId", title: "Warehouse", render: (_v, row) => resolvedLabel(warehouseLabels, row.warehouseId) },
          { key: "quantity", title: "Current Quantity", dataIndex: "quantity" },
          { key: "uomId", title: "UOM", render: (_v, row) => resolvedLabel(uomLabels, row.uomId) },
        ]}
      />

      {selected && (
        <MovementHistoryModal
          itemId={selected.itemId}
          warehouseId={selected.warehouseId}
          itemLabel={resolvedLabel(itemLabels, selected.itemId)}
          warehouseLabel={resolvedLabel(warehouseLabels, selected.warehouseId)}
          onClose={() => setSelected(null)}
        />
      )}
    </Space>
  );
}
