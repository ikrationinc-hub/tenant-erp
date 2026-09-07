import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, Col, DatePicker, Row, Space, Statistic, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

interface SalesDashboardSnapshot {
  totalSalesUsd: string;
  grossProfitUsd: string;
  netProfitUsd: string;
  outstandingReceivablesUsd: string;
  shipmentPendingCount: number;
  openContractsCount: number;
  completedContractsCount: number;
  totalPurchasesUsd: string;
}

interface BreakdownRow {
  salesAmountUsd: string;
}

interface CustomerBreakdownRow extends BreakdownRow {
  customerId: string;
}
interface ItemBreakdownRow extends BreakdownRow {
  itemId: string;
}
interface CountryBreakdownRow extends BreakdownRow {
  countryId: string;
}

interface SalesDashboardResponse {
  periodMonth: string;
  snapshot: SalesDashboardSnapshot | null;
  customerBreakdown: CustomerBreakdownRow[];
  itemBreakdown: ItemBreakdownRow[];
  countryBreakdown: CountryBreakdownRow[];
}

function useMasterLabels(master: string): Map<string, string> {
  const query = useQuery({
    queryKey: ["field-options", master],
    queryFn: () => apiFetch(endpoints.masterOptions(master), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  const options = query.data?.options ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- options is a fresh array every render; re-keying on it would rebuild the Map every render for no reason.
  return useMemo(() => new Map(options.map((option) => [option.value, option.label])), [query.data]);
}

/** Reads the amount as-is (rule 3: the frontend never calculates money) - every figure here is already server-computed by the S-6 refresh job, this component only ever displays strings. */
function toDisplayAmount(value: string): number {
  // AntD Statistic/Recharts both require a real number to render (no
  // decimal.js math happens on it - this is display-only, the same class
  // of exception SchemaTable's own numeric columns already make when
  // handing a value to an AntD component that insists on `number`, never
  // used to derive a NEW figure).
  return Number(value);
}

interface BarDatum {
  label: string;
  amount: number;
}

function BreakdownBarChart({ data }: { data: BarDatum[] }): ReactElement {
  if (data.length === 0) {
    return <Typography.Text type="secondary">No data for this period.</Typography.Text>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="amount" fill="#1677ff" />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * S-6 (docs/SALES-MODULE-PLAN.md): reads ONLY GET /sales/dashboard, which
 * itself reads only the cache tables the BullMQ refresh job populates -
 * this screen never computes a KPI itself (frontend rule 3's spirit
 * extended to aggregates, not just single amounts). A month with no
 * refresh yet renders every card as "-", not an error - a genuinely
 * empty dashboard state (sales-dashboard.service.ts's own getDashboard
 * doc comment).
 */
export function SalesDashboardScreen(): ReactElement {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const customerLabels = useMasterLabels("customers");
  const itemLabels = useMasterLabels("items");
  const countryLabels = useMasterLabels("countries");

  const monthParam = month.format("YYYY-MM");
  const dashboardQuery = useQuery({
    queryKey: ["sales-dashboard", monthParam],
    queryFn: () => apiFetch<SalesDashboardResponse>(`${endpoints.salesDashboard}?month=${monthParam}`),
  });

  const snapshot = dashboardQuery.data?.snapshot;

  const customerData: BarDatum[] = (dashboardQuery.data?.customerBreakdown ?? []).map((row) => ({
    label: customerLabels.get(row.customerId) ?? row.customerId.slice(0, 8),
    amount: toDisplayAmount(row.salesAmountUsd),
  }));
  const itemData: BarDatum[] = (dashboardQuery.data?.itemBreakdown ?? []).map((row) => ({
    label: itemLabels.get(row.itemId) ?? row.itemId.slice(0, 8),
    amount: toDisplayAmount(row.salesAmountUsd),
  }));
  const countryData: BarDatum[] = (dashboardQuery.data?.countryBreakdown ?? []).map((row) => ({
    label: countryLabels.get(row.countryId) ?? row.countryId.slice(0, 8),
    amount: toDisplayAmount(row.salesAmountUsd),
  }));
  const salesVsPurchaseData: BarDatum[] = snapshot
    ? [
        { label: "Sales", amount: toDisplayAmount(snapshot.totalSalesUsd) },
        { label: "Purchases", amount: toDisplayAmount(snapshot.totalPurchasesUsd) },
      ]
    : [];

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Sales Dashboard
        </Typography.Title>
        <DatePicker picker="month" value={month} onChange={(value) => setMonth(value ?? dayjs())} allowClear={false} />
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Total Sales (USD)" value={snapshot ? toDisplayAmount(snapshot.totalSalesUsd) : "-"} precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Gross Profit (USD)" value={snapshot ? toDisplayAmount(snapshot.grossProfitUsd) : "-"} precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Net Profit (USD)" value={snapshot ? toDisplayAmount(snapshot.netProfitUsd) : "-"} precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Outstanding Receivables (USD)" value={snapshot ? toDisplayAmount(snapshot.outstandingReceivablesUsd) : "-"} precision={2} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Shipment Pending" value={snapshot ? snapshot.shipmentPendingCount : "-"} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Open Contracts" value={snapshot ? snapshot.openContractsCount : "-"} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Completed Contracts" value={snapshot ? snapshot.completedContractsCount : "-"} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card size="small">
            <Statistic title="Total Purchases (USD)" value={snapshot ? toDisplayAmount(snapshot.totalPurchasesUsd) : "-"} precision={2} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Customer-wise Sales" size="small">
            <BreakdownBarChart data={customerData} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Item-wise Sales" size="small">
            <BreakdownBarChart data={itemData} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Country-wise Sales" size="small">
            <BreakdownBarChart data={countryData} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Sales vs Purchase" size="small">
            <BreakdownBarChart data={salesVsPurchaseData} />
          </Card>
        </Col>
      </Row>

      {!snapshot && !dashboardQuery.isLoading && (
        <Typography.Text type="secondary">
          No dashboard data for {asDisplayString(monthParam)} yet - the refresh job hasn't run for this period.
        </Typography.Text>
      )}
    </Space>
  );
}
