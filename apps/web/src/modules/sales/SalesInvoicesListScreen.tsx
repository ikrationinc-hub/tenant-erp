import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Space, Typography } from "antd";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { INVOICE_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { SALES_LIST_PATH } from "./SalesListScreen";
import type { EntityRow } from "../../core/schema-table/types";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function salesId(row: EntityRow): string {
  return typeof row.salesId === "string" ? row.salesId : "";
}

/**
 * S-5 (docs/SALES-MODULE-PLAN.md): mirrors PurchaseBillsListScreen.tsx -
 * a flat, filterable table of every invoice across every sale (GET
 * /sales-invoices, server-side paginated per rule 10). No create action
 * here - an invoice is always created FROM its parent Sales Order
 * (SalesDetailScreen's Invoice action), same convention as Purchase
 * Bill's own standalone list. Row click opens the parent Sales Order.
 */
export const SALES_INVOICES_LIST_PATH = "/sales/invoices";

export function SalesInvoicesListScreen(): ReactElement {
  const navigate = useNavigate();

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Invoices
        </Typography.Title>
      </Space>

      <SchemaTable
        module="sales"
        entity="invoice"
        endpoint={endpoints.allSalesInvoices}
        columns={[
          { fieldKey: "invoiceNumber", monospace: true },
          { fieldKey: "invoiceDate" },
          { fieldKey: "dueDate", hidden: true },
        ]}
        extraColumns={[
          {
            key: "salesNumber",
            title: "Sales Order",
            after: "invoiceNumber",
            width: 160,
            render: (row) => asDisplayString(row.salesNumber) || "—",
          },
          {
            key: "invoiceAmountUsd",
            title: "Amount (USD)",
            after: "salesNumber",
            width: 130,
            render: (row) => asDisplayString(row.invoiceAmountUsd) || "—",
          },
          {
            key: "status",
            title: "Status",
            after: "invoiceAmountUsd",
            width: 110,
            render: (row) => <StatusTag value={asDisplayString(row.status)} colorMap={INVOICE_STATUS_COLORS} />,
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
              { label: "Reversed", value: "reversed" },
              { label: "Paid", value: "paid" },
            ],
          },
          { key: "invoiceDate", label: "Invoice Date", type: "dateRange" },
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
