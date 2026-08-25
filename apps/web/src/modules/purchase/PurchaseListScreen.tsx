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
import { PURCHASE_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { steelCobalt } from "../../theme/palette";

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

/**
 * Reads only `.total` off the SAME paginated /purchases endpoint the table
 * itself queries (pageSize 1, so the body stays tiny) - a live per-status
 * breakdown under whatever OTHER filters (search/date/supplier/branch) are
 * already active. Deliberately not a separate aggregate endpoint or a
 * fetch-all-and-count: every count here is still a server-side, filtered
 * COUNT (backend rule 10), just with status swapped per call.
 */
function usePurchaseStatusTotal(status: string | undefined, sharedParams: Record<string, string | undefined>) {
  const params = { ...sharedParams, page: "1", pageSize: "1", ...(status ? { status } : {}) };
  return useQuery({
    queryKey: ["purchase-status-total", params],
    queryFn: () => apiFetch(withQuery(endpoints.purchases, params), {}, { schema: paginatedRowsResponseSchema }),
    placeholderData: keepPreviousData,
  });
}

/** One card in the status strip above the filter bar - colored from the same map StatusTag's pill uses, so both surfaces read as one system. A real <button>, not a styled <div>, so it's keyboard-operable for free. */
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

  // Mirrors the same URL SchemaTable's own useEntityListState reads/writes
  // (search params are shared app-wide state, not local to one component) -
  // so a chip click here and the filter bar below it stay in sync for free.
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedCountParams = {
    search: searchParams.get("search") ?? undefined,
    supplierId: searchParams.get("supplierId") ?? undefined,
    branchId: searchParams.get("branchId") ?? undefined,
    purchaseDateFrom: searchParams.get("purchaseDateFrom") ?? undefined,
    purchaseDateTo: searchParams.get("purchaseDateTo") ?? undefined,
  };
  const activeStatus = searchParams.get("status") ?? undefined;
  const totalCount = usePurchaseStatusTotal(undefined, sharedCountParams);
  const draftCount = usePurchaseStatusTotal("draft", sharedCountParams);
  const approvedCount = usePurchaseStatusTotal("approved", sharedCountParams);
  const postedCount = usePurchaseStatusTotal("posted", sharedCountParams);

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
            Purchase Orders
          </Typography.Title>
          <Typography.Text type="secondary">{totalCount.data?.total ?? "…"} orders</Typography.Text>
        </div>
        <Can permission="purchase.po.create">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate(`${PURCHASE_LIST_PATH}/new`)}>
            New Purchase
          </Button>
        </Can>
      </Space>

      <Space wrap size={10}>
        <StatChip label="Total" value={totalCount.data?.total} color={steelCobalt.base} active={!activeStatus} onClick={() => filterByStatus(undefined)} />
        <StatChip
          label="Draft"
          value={draftCount.data?.total}
          color={PURCHASE_STATUS_COLORS.draft}
          active={activeStatus === "draft"}
          onClick={() => filterByStatus("draft")}
        />
        <StatChip
          label="Approved"
          value={approvedCount.data?.total}
          color={PURCHASE_STATUS_COLORS.approved}
          active={activeStatus === "approved"}
          onClick={() => filterByStatus("approved")}
        />
        <StatChip
          label="Posted"
          value={postedCount.data?.total}
          color={PURCHASE_STATUS_COLORS.posted}
          active={activeStatus === "posted"}
          onClick={() => filterByStatus("posted")}
        />
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
          { fieldKey: "purchaseNumber", monospace: true },
          { fieldKey: "divisionId", title: "Division", render: (value) => resolvedLabel(divisionLabels, value) },
          { fieldKey: "branchId", render: (value) => resolvedLabel(branchLabels, value) },
          { fieldKey: "buyerId", render: (value) => resolvedLabel(buyerLabels, value) },
          { fieldKey: "supplierId", render: (value) => resolvedLabel(supplierLabels, value) },
          { fieldKey: "supplierInvoiceNo", monospace: true },
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
          {
            key: "status",
            title: "Status",
            after: "purchaseNumber",
            width: 110,
            render: (row) => <StatusTag value={asDisplayString(row.status)} colorMap={PURCHASE_STATUS_COLORS} />,
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
        rowActionKey="open"
      />
    </Space>
  );
}
