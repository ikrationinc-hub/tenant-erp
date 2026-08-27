import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { BILL_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { Can } from "../../core/permissions/Can";
import { PURCHASE_LIST_PATH } from "./PurchaseListScreen";
import { NewPurchaseBillDrawer } from "./PurchaseFulfilmentPanels";
import type { EntityRow } from "../../core/schema-table/types";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function purchaseId(row: EntityRow): string {
  return typeof row.purchaseId === "string" ? row.purchaseId : "";
}

/**
 * PL-4: Zoho's own "Bills" nav item - a flat, filterable table of every
 * bill across every purchase (GET /purchase-bills, server-side paginated
 * per rule 10). No create action here - a bill is always created FROM its
 * parent PO's "Convert to Bill" action, same reasoning as the Receipts
 * list screen. Row click opens the parent PO.
 */
export const PURCHASE_BILLS_LIST_PATH = "/purchase/bills";

export function PurchaseBillsListScreen(): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Bills
        </Typography.Title>
        <Can permission="purchase.invoice.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New
          </Button>
        </Can>
      </Space>

      <NewPurchaseBillDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.allPurchaseBills] });
        }}
      />

      <SchemaTable
        module="purchase"
        entity="invoice"
        endpoint={endpoints.allPurchaseBills}
        columns={[
          { fieldKey: "invoiceNumber", monospace: true },
          { fieldKey: "invoiceDate" },
          { fieldKey: "dueDate" },
          { fieldKey: "invoiceAmountUsd", monospace: true },
          { fieldKey: "taxAmount", hidden: true },
          { fieldKey: "invoiceFile", hidden: true },
        ]}
        extraColumns={[
          {
            key: "purchaseNumber",
            title: "Purchase Order",
            after: "invoiceNumber",
            width: 160,
            render: (row) => asDisplayString(row.purchaseNumber) || "—",
          },
          {
            key: "status",
            title: "Status",
            after: "purchaseNumber",
            width: 110,
            render: (row) => <StatusTag value={asDisplayString(row.status)} colorMap={BILL_STATUS_COLORS} />,
          },
        ]}
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { label: "Draft", value: "draft" },
              { label: "Approved", value: "approved" },
              { label: "Paid", value: "paid" },
              { label: "Reversed", value: "reversed" },
            ],
          },
          { key: "billDate", label: "Invoice Date", type: "dateRange" },
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
