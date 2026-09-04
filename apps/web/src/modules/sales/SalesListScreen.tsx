import type { ReactElement } from "react";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema, paginatedRowsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { Can } from "../../core/permissions/Can";
import { endpoints, withQuery } from "../../core/api/endpoints";
import type { EntityRow } from "../../core/schema-table/types";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { SALES_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { steelCobalt } from "../../theme/palette";

function useMasterOptions(endpoint: string) {
  const query = useQuery({
    queryKey: ["field-options", endpoint],
    queryFn: () => apiFetch(endpoint, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

export const SALES_LIST_PATH = "/sales/orders";

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Mirrors PurchaseListScreen's usePurchaseStatusTotal exactly - a live, server-side filtered count per chip, reusing the SAME paginated /sales endpoint the table itself queries (pageSize 1). */
function useSalesStatusTotal(status: string | undefined, sharedParams: Record<string, string | undefined>) {
  const params = { ...sharedParams, page: "1", pageSize: "1", ...(status ? { status } : {}) };
  return useQuery({
    queryKey: ["sales-status-total", params],
    queryFn: () => apiFetch(withQuery(endpoints.sales, params), {}, { schema: paginatedRowsResponseSchema }),
    placeholderData: keepPreviousData,
  });
}

/** Mirrors PurchaseListScreen's StatChip exactly. */
function StatChip({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number | undefined;
  color: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className="stat-chip"
      style={{ borderLeftColor: color, boxShadow: active ? `0 0 0 1px ${color} inset` : undefined }}
      onClick={onClick}
    >
      <span className="stat-chip-label">
        <span className="stat-chip-dot" style={{ background: color }} />
        {label}
      </span>
      <span className="stat-chip-value">{value ?? "–"}</span>
    </button>
  );
}

/**
 * S-3 (docs/SALES-MODULE-PLAN.md): filter by status/customer/branch/
 * division/date range, all server-side (backend rule 10). No Delivered/
 * Invoiced/Paid fulfilment-dot columns yet - S-4/S-5 don't exist, so
 * there's nothing real to derive them from (mirrors PurchaseListScreen's
 * own shape minus those three columns, per this phase's own scope).
 */
export function SalesListScreen(): ReactElement {
  const navigate = useNavigate();
  const customers = useMasterOptions(endpoints.masterOptions("customers"));
  const branches = useMasterOptions(endpoints.branchOptions);
  const divisions = useMasterOptions(endpoints.masterOptions("divisions"));

  const customerLabels = useMemo(() => new Map(customers.map((option) => [option.value, option.label])), [customers]);
  const branchLabels = useMemo(() => new Map(branches.map((option) => [option.value, option.label])), [branches]);
  const divisionLabels = useMemo(() => new Map(divisions.map((option) => [option.value, option.label])), [divisions]);

  function resolvedLabel(labels: Map<string, string>, value: unknown): string {
    const id = asDisplayString(value);
    return labels.get(id) ?? id;
  }

  const [searchParams, setSearchParams] = useSearchParams();
  const sharedCountParams = {
    search: searchParams.get("search") ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    branchId: searchParams.get("branchId") ?? undefined,
    salesDateFrom: searchParams.get("salesDateFrom") ?? undefined,
    salesDateTo: searchParams.get("salesDateTo") ?? undefined,
  };
  const activeStatus = searchParams.get("status") ?? undefined;
  const totalCount = useSalesStatusTotal(undefined, sharedCountParams);
  const draftCount = useSalesStatusTotal("draft", sharedCountParams);
  const approvedCount = useSalesStatusTotal("approved", sharedCountParams);
  const closedCount = useSalesStatusTotal("closed", sharedCountParams);
  const cancelledCount = useSalesStatusTotal("cancelled", sharedCountParams);

  function filterByStatus(status: string | undefined): void {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (status) {
        next.set("status", status);
      } else {
        next.delete("status");
      }
      next.set("page", "1");
      return next;
    });
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Sales Orders
          </Typography.Title>
          <Typography.Text type="secondary">{totalCount.data?.total ?? "…"} orders</Typography.Text>
        </div>
        <Can permission="sales.order.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate(`${SALES_LIST_PATH}/new`)}>
            New Sale
          </Button>
        </Can>
      </Space>

      <Space wrap size={10}>
        <StatChip label="Total" value={totalCount.data?.total} color={steelCobalt.base} active={!activeStatus} onClick={() => filterByStatus(undefined)} />
        <StatChip
          label="Draft"
          value={draftCount.data?.total}
          color={SALES_STATUS_COLORS.draft ?? steelCobalt.base}
          active={activeStatus === "draft"}
          onClick={() => filterByStatus("draft")}
        />
        <StatChip
          label="Approved"
          value={approvedCount.data?.total}
          color={SALES_STATUS_COLORS.approved ?? steelCobalt.base}
          active={activeStatus === "approved"}
          onClick={() => filterByStatus("approved")}
        />
        <StatChip
          label="Closed"
          value={closedCount.data?.total}
          color={SALES_STATUS_COLORS.closed ?? steelCobalt.base}
          active={activeStatus === "closed"}
          onClick={() => filterByStatus("closed")}
        />
        <StatChip
          label="Cancelled"
          value={cancelledCount.data?.total}
          color={SALES_STATUS_COLORS.cancelled ?? steelCobalt.base}
          active={activeStatus === "cancelled"}
          onClick={() => filterByStatus("cancelled")}
        />
      </Space>

      <SchemaTable
        module="sales"
        entity="header"
        endpoint={endpoints.sales}
        columns={[
          { fieldKey: "salesNumber", monospace: true },
          { fieldKey: "divisionId", title: "Division", render: (value) => resolvedLabel(divisionLabels, value) },
          { fieldKey: "branchId", render: (value) => resolvedLabel(branchLabels, value) },
          { fieldKey: "customerId", render: (value) => resolvedLabel(customerLabels, value) },
          { fieldKey: "pricingType", hidden: true },
          { fieldKey: "customerReferenceNo", hidden: true },
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
        ]}
        extraColumns={[
          {
            key: "status",
            title: "Status",
            after: "salesNumber",
            width: 110,
            render: (row) => <StatusTag value={asDisplayString(row.status)} colorMap={SALES_STATUS_COLORS} />,
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
              { label: "Closed", value: "closed" },
              { label: "Cancelled", value: "cancelled" },
            ],
          },
          { key: "salesDate", label: "Sales Date", type: "dateRange" },
          { key: "divisionId", label: "Division", type: "select", options: divisions },
          { key: "customerId", label: "Customer", type: "select", options: customers },
          { key: "branchId", label: "Branch", type: "select", options: branches },
        ]}
        actions={[
          {
            key: "open",
            label: "Open",
            permission: "sales.order.read",
            onClick: (row) => void navigate(`${SALES_LIST_PATH}/${rowId(row)}`),
          },
        ]}
        rowActionKey="open"
      />
    </Space>
  );
}
