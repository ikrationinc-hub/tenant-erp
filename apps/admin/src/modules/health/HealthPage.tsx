import type { ReactElement } from "react";
import { Card, Col, Row, Skeleton, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { PlatformHealthTenantStatus, TenantStatus } from "@hyperion/contracts";
import { usePlatformHealthQuery } from "./api";

const TENANT_STATUS_COLOR: Record<TenantStatus, string> = {
  active: "success",
  provisioning: "processing",
  suspended: "error",
};

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function ReachabilityTag({ reachable }: { reachable: boolean }): ReactElement {
  return reachable ? <Tag color="success">UP</Tag> : <Tag color="error">DOWN</Tag>;
}

function migrationStatus(tenant: PlatformHealthTenantStatus): { color: string; label: string } {
  if (!tenant.schemaPresent) {
    return { color: "error", label: "MISSING SCHEMA" };
  }
  if (!tenant.upToDate) {
    return { color: "warning", label: "LAGGING" };
  }
  return { color: "success", label: "UP TO DATE" };
}

const tenantColumns: ColumnsType<PlatformHealthTenantStatus> = [
  { title: "Slug", dataIndex: "slug", key: "slug" },
  {
    title: "Tenant status",
    dataIndex: "status",
    key: "status",
    render: (status: TenantStatus) => <Tag color={TENANT_STATUS_COLOR[status]}>{status.toUpperCase()}</Tag>,
  },
  {
    title: "Migration version",
    dataIndex: "lastMigrationVersion",
    key: "lastMigrationVersion",
    render: (version: string | undefined) => version ?? "—",
  },
  {
    title: "Migration status",
    key: "migrationStatus",
    // This is the single most useful operational view here (ADM-5 task item
    // 3) - a tenant a version behind its peers is exactly the failed-fan-out
    // scenario BE-4's runner warns about, and it's invisible everywhere else.
    render: (_: unknown, tenant) => {
      const { color, label } = migrationStatus(tenant);
      return <Tag color={color}>{label}</Tag>;
    },
  },
];

/** ADM-5 - infrastructure health only. No business metrics (revenue, purchase counts, ...) appear anywhere on this page. */
export function HealthPage(): ReactElement {
  const { data, isLoading, isError } = usePlatformHealthQuery();

  if (isLoading) {
    return (
      <div>
        <Typography.Title level={4}>Health</Typography.Title>
        <Skeleton active />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <Typography.Title level={4}>Health</Typography.Title>
        <Tag color="error">Could not load platform health</Tag>
      </div>
    );
  }

  return (
    <div>
      <Typography.Title level={4}>Health</Typography.Title>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card size="small" title="API">
            <Tag color="success">UP</Tag>
            <div>Version: {data.api.version}</div>
            <div>Uptime: {formatUptime(data.api.uptimeSeconds)}</div>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title="Postgres">
            <ReachabilityTag reachable={data.postgres.reachable} />
            <div>
              Pool: {data.postgres.pool.idle} idle / {data.postgres.pool.total} total
              {data.postgres.pool.waiting > 0 ? `, ${data.postgres.pool.waiting} waiting` : ""}
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title="Redis">
            <ReachabilityTag reachable={data.redis.reachable} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title="Worker">
            <ReachabilityTag reachable={data.worker.reachable} />
            <div>
              Last heartbeat:{" "}
              {data.worker.lastHeartbeatAt ? new Date(data.worker.lastHeartbeatAt).toLocaleTimeString() : "—"}
            </div>
          </Card>
        </Col>
      </Row>

      <Typography.Title level={5}>Tenant migrations</Typography.Title>
      <Table<PlatformHealthTenantStatus> rowKey="id" columns={tenantColumns} dataSource={data.tenants} />
    </div>
  );
}
