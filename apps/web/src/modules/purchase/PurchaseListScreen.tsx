import type { ReactElement } from "react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Space, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { Can } from "../../core/permissions/Can";
import { endpoints } from "../../core/api/endpoints";
import type { EntityRow } from "../../core/schema-table/types";

function useMasterOptions(endpoint: string) {
  const query = useQuery({
    queryKey: ["field-options", endpoint],
    queryFn: () => apiFetch(endpoint, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

export const PURCHASE_LIST_PATH = "/purchase/orders";

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

const STATUS_COLOR: Record<string, string> = { draft: "default", approved: "blue", posted: "green" };

function StatusTag({ row }: { row: EntityRow }): ReactElement {
  const status = asDisplayString(row.status);
  return <Tag color={STATUS_COLOR[status] ?? "default"}>{status ? status.charAt(0).toUpperCase() + status.slice(1) : "—"}</Tag>;
}

/** FE-6 §10: filter by status, date range, supplier, branch - all server-side (backend rule 10). Row click opens the detail screen (header/shipment/items/... - session (e)'s workflow lives there too). */
export function PurchaseListScreen(): ReactElement {
  const navigate = useNavigate();
  const suppliers = useMasterOptions(endpoints.supplierOptions);
  const branches = useMasterOptions(endpoints.branchOptions);
  const buyers = useMasterOptions(endpoints.companyOptions);
  const divisions = useMasterOptions(endpoints.masterOptions("divisions"));

  const supplierLabels = useMemo(() => new Map(suppliers.map((option) => [option.value, option.label])), [suppliers]);
  const branchLabels = useMemo(() => new Map(branches.map((option) => [option.value, option.label])), [branches]);
  const buyerLabels = useMemo(() => new Map(buyers.map((option) => [option.value, option.label])), [buyers]);
  const divisionLabels = useMemo(() => new Map(divisions.map((option) => [option.value, option.label])), [divisions]);

  function resolvedLabel(labels: Map<string, string>, value: unknown): string {
    const id = asDisplayString(value);
    return labels.get(id) ?? id;
  }

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
        // The "header" entity also carries every shipment/attachment
        // field (24 in total) - none of those belong in a list view, so
        // every field beyond the handful worth scanning at a glance is
        // hidden rather than shown as a bare, unresolved UUID or an
        // unreadably wide row. `status` isn't a field-definitions field
        // at all (it's system-controlled, never part of the create/edit
        // form) - see extraColumns below.
        columns={[
          { fieldKey: "divisionId", title: "Division", render: (value) => resolvedLabel(divisionLabels, value) },
          { fieldKey: "branchId", render: (value) => resolvedLabel(branchLabels, value) },
          { fieldKey: "buyerId", render: (value) => resolvedLabel(buyerLabels, value) },
          { fieldKey: "supplierId", render: (value) => resolvedLabel(supplierLabels, value) },
          { fieldKey: "pricingType", hidden: true },
          { fieldKey: "supplierReferenceNo", hidden: true },
          { fieldKey: "brokerId", hidden: true },
          { fieldKey: "brokerCommission", hidden: true },
          { fieldKey: "lotNumber", hidden: true },
          { fieldKey: "containerId", hidden: true },
          { fieldKey: "blNo", hidden: true },
          { fieldKey: "loadingDate", hidden: true },
          { fieldKey: "transportModeId", hidden: true },
          { fieldKey: "vesselId", hidden: true },
          { fieldKey: "voyageNumber", hidden: true },
          { fieldKey: "portOfLoadingId", hidden: true },
          { fieldKey: "portOfDischargeId", hidden: true },
          { fieldKey: "warehouseId", hidden: true },
          { fieldKey: "incotermId", hidden: true },
          { fieldKey: "invoice", hidden: true },
          { fieldKey: "billOfLading", hidden: true },
          { fieldKey: "packingList", hidden: true },
          { fieldKey: "certificateOfOrigin", hidden: true },
          { fieldKey: "otherDocuments", hidden: true },
          { fieldKey: "otherDocuments2", hidden: true },
        ]}
        extraColumns={[
          { key: "status", title: "Status", after: "purchaseNumber", width: 110, render: (row) => <StatusTag row={row} /> },
        ]}
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
          { key: "supplierId", label: "Supplier", type: "select", options: suppliers },
          { key: "branchId", label: "Branch", type: "select", options: branches },
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
