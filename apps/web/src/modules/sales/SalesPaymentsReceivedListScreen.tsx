import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { Can } from "../../core/permissions/Can";
import { NewPaymentReceivedDrawer } from "./SalesPaymentReceivedForm";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function useMasterOptions(endpoint: string) {
  const query = useQuery({
    queryKey: ["field-options", endpoint],
    queryFn: () => apiFetch(endpoint, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

/**
 * S-5 (docs/SALES-MODULE-PLAN.md): Zoho's own "Payments Received" nav
 * item, mirroring PurchasePaymentsListScreen.tsx exactly - a flat,
 * filterable table of every payment across every customer (GET
 * /payments-received, server-side paginated per rule 10). A Payment
 * Received IS creatable directly from here (Customer -> outstanding
 * invoices), same as Purchase Payment's own "New" button.
 */
export const SALES_PAYMENTS_RECEIVED_LIST_PATH = "/sales/receipts";

export function SalesPaymentsReceivedListScreen(): ReactElement {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const customers = useMasterOptions(endpoints.customerOptions);
  const customerLabels = useMemo(() => new Map(customers.map((option) => [option.value, option.label])), [customers]);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Payments Received
        </Typography.Title>
        <Can permission="sales.receipt.record">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New
          </Button>
        </Can>
      </Space>

      <NewPaymentReceivedDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.paymentsReceived] });
        }}
      />

      <SchemaTable
        module="sales"
        entity="receipt"
        endpoint={endpoints.paymentsReceived}
        columns={[
          { fieldKey: "paymentNumber", monospace: true },
          {
            fieldKey: "customerId",
            title: "Customer",
            render: (value) => customerLabels.get(asDisplayString(value)) ?? asDisplayString(value),
          },
          { fieldKey: "paymentDate" },
          { fieldKey: "paymentMode" },
          { fieldKey: "referenceNumber" },
          { fieldKey: "notes", hidden: true },
        ]}
        extraColumns={[
          {
            key: "paymentAmountUsd",
            title: "Amount (USD)",
            after: "paymentMode",
            width: 130,
            render: (row) => asDisplayString(row.paymentAmountUsd) || "—",
          },
        ]}
        filters={[{ key: "paymentDate", label: "Payment Date", type: "dateRange" }]}
      />
    </Space>
  );
}
