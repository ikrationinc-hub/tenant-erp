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
import { NewPaymentDrawer } from "./PurchasePaymentForm";

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
 * PL-5: Zoho's own "Payments Made" nav item - a flat, filterable table of
 * every payment across every supplier (GET /payments, server-side
 * paginated per rule 10). Unlike Receipt/Bill's own standalone lists, a
 * Payment IS creatable directly from here (Zoho's own "New" button opens
 * Vendor -> outstanding bills, not "pick an existing document first") -
 * there's no PO/Bill detail screen a Payment is created "from" the way a
 * Receipt/Bill is created from its parent PO.
 */
export const PURCHASE_PAYMENTS_LIST_PATH = "/purchase/payments";

export function PurchasePaymentsListScreen(): ReactElement {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const suppliers = useMasterOptions(endpoints.supplierOptions);
  const supplierLabels = useMemo(() => new Map(suppliers.map((option) => [option.value, option.label])), [suppliers]);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Payments Made
        </Typography.Title>
        <Can permission="purchase.payment.record">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New
          </Button>
        </Can>
      </Space>

      <NewPaymentDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onDone={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.payments] });
        }}
      />

      <SchemaTable
        module="purchase"
        entity="payment"
        endpoint={endpoints.payments}
        columns={[
          { fieldKey: "paymentNumber", monospace: true },
          {
            fieldKey: "supplierId",
            title: "Supplier",
            render: (value) => supplierLabels.get(asDisplayString(value)) ?? asDisplayString(value),
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
