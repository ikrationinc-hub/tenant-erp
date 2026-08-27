import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { RECEIPT_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { Can } from "../../core/permissions/Can";
import { PURCHASE_LIST_PATH } from "./PurchaseListScreen";
import { NewPurchaseReceiptDrawer } from "./PurchaseFulfilmentPanels";
import type { EntityRow } from "../../core/schema-table/types";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function purchaseId(row: EntityRow): string {
  return typeof row.purchaseId === "string" ? row.purchaseId : "";
}

/**
 * PL-4: Zoho's own "Purchase Receives" nav item - a flat, filterable
 * table of every receipt across every purchase (GET /purchase-receipts,
 * server-side paginated per rule 10). No create action here - a receipt
 * is always created FROM its parent PO (PurchaseDetailScreen's Receive
 * action), matching the prompt's own "Receipt and Bill are independently
 * operable [after creation]" framing, not independently creatable from
 * a blank slate. Row click opens the parent PO, where the receipt itself
 * (and the full fulfilment strip) is visible.
 */
export const PURCHASE_RECEIPTS_LIST_PATH = "/purchase/receipts";

export function PurchaseReceiptsListScreen(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Purchase Receipts
        </Typography.Title>
        <Can permission="purchase.receipt.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New
          </Button>
        </Can>
      </Space>

      <NewPurchaseReceiptDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.allPurchaseReceipts] });
        }}
      />

      <SchemaTable
        module="purchase"
        entity="receipt"
        endpoint={endpoints.allPurchaseReceipts}
        columns={[
          { fieldKey: "receiptNumber", monospace: true },
          { fieldKey: "receiptDate" },
          { fieldKey: "warehouseId", hidden: true },
        ]}
        extraColumns={[
          {
            key: "purchaseNumber",
            title: "Purchase Order",
            after: "receiptNumber",
            width: 160,
            render: (row) => asDisplayString(row.purchaseNumber) || "—",
          },
          {
            key: "status",
            title: "Status",
            after: "purchaseNumber",
            width: 110,
            render: (row) => <StatusTag value={asDisplayString(row.status)} colorMap={RECEIPT_STATUS_COLORS} />,
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
          { key: "receiptDate", label: "Receipt Date", type: "dateRange" },
        ]}
        actions={[
          {
            key: "open",
            label: "Open PO",
            permission: "purchase.po.read",
            onClick: (row) => void navigate(`${PURCHASE_LIST_PATH}/${purchaseId(row)}`),
          },
        ]}
        rowActionKey="open"
      />
    </Space>
  );
}
