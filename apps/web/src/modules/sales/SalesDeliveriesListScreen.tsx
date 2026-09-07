import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { DELIVERY_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { Can } from "../../core/permissions/Can";
import { SALES_LIST_PATH } from "./SalesListScreen";
import { NewSalesDeliveryDrawer } from "./SalesFulfilmentPanels";
import type { EntityRow } from "../../core/schema-table/types";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function salesId(row: EntityRow): string {
  return typeof row.salesId === "string" ? row.salesId : "";
}

/**
 * S-4 (docs/SALES-MODULE-PLAN.md): mirrors PurchaseReceiptsListScreen.tsx
 * exactly - a flat, filterable table of every delivery across every sale
 * (GET /sales-deliveries, server-side paginated per rule 10). No create
 * action here beyond the picker-backed "New" button - a delivery is
 * normally created FROM its parent Sales Order (SalesDetailScreen's
 * Deliver action). Row click opens the parent Sales Order, where the
 * delivery itself is visible.
 */
export const SALES_DELIVERIES_LIST_PATH = "/sales/deliveries";

export function SalesDeliveriesListScreen(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Deliveries
        </Typography.Title>
        <Can permission="sales.delivery.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New
          </Button>
        </Can>
      </Space>

      <NewSalesDeliveryDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.allSalesDeliveries] });
        }}
      />

      <SchemaTable
        module="sales"
        entity="delivery"
        endpoint={endpoints.allSalesDeliveries}
        columns={[
          { fieldKey: "deliveryOrderNo", monospace: true },
          { fieldKey: "dispatchDate" },
          { fieldKey: "warehouseId", hidden: true },
        ]}
        extraColumns={[
          {
            key: "salesNumber",
            title: "Sales Order",
            after: "deliveryOrderNo",
            width: 160,
            render: (row) => asDisplayString(row.salesNumber) || "—",
          },
          {
            key: "status",
            title: "Status",
            after: "salesNumber",
            width: 110,
            render: (row) => <StatusTag value={asDisplayString(row.status)} colorMap={DELIVERY_STATUS_COLORS} />,
          },
        ]}
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { label: "Draft", value: "draft" },
              { label: "Confirmed", value: "confirmed" },
              { label: "Reversed", value: "reversed" },
            ],
          },
          { key: "dispatchDate", label: "Dispatch Date", type: "dateRange" },
        ]}
        actions={[
          {
            key: "open",
            label: "Open Sales Order",
            permission: "sales.order.read",
            onClick: (row) => void navigate(`${SALES_LIST_PATH}/${salesId(row)}`),
          },
        ]}
        rowActionKey="open"
      />
    </Space>
  );
}
