import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { Can } from "../../core/permissions/Can";
import { endpoints } from "../../core/api/endpoints";
import type { EntityRow } from "../../core/schema-table/types";

function useFilterOptions(endpoint: string) {
  const query = useQuery({
    queryKey: ["field-options", endpoint],
    queryFn: () => apiFetch(endpoint, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return (query.data?.options ?? []).map((option) => ({ label: option.label, value: option.value }));
}

export const PURCHASE_LIST_PATH = "/purchase/orders";

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/** FE-6 §10: filter by status, date range, supplier, branch - all server-side (backend rule 10). Row click opens the detail screen (header/shipment/items/... - session (e)'s workflow lives there too). */
export function PurchaseListScreen(): ReactElement {
  const navigate = useNavigate();
  const supplierOptions = useFilterOptions(endpoints.supplierOptions);
  const branchOptions = useFilterOptions(endpoints.branchOptions);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Purchase Orders
        </Typography.Title>
        <Can permission="purchase.po.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate(`${PURCHASE_LIST_PATH}/new`)}>
            New Purchase
          </Button>
        </Can>
      </Space>

      <SchemaTable
        module="purchase"
        entity="header"
        endpoint={endpoints.purchases}
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { label: "Draft", value: "draft" },
              { label: "Approved", value: "approved" },
              { label: "Posted", value: "posted" },
            ],
          },
          { key: "purchaseDate", label: "Purchase Date", type: "dateRange" },
          { key: "supplierId", label: "Supplier", type: "select", options: supplierOptions },
          { key: "branchId", label: "Branch", type: "select", options: branchOptions },
        ]}
        actions={[
          {
            key: "open",
            label: "Open",
            permission: "purchase.po.read",
            onClick: (row) => void navigate(`${PURCHASE_LIST_PATH}/${rowId(row)}`),
          },
        ]}
      />
    </Space>
  );
}
