import { useState, type ReactElement } from "react";
import { Button, Empty, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { TenantListItem, TenantStatus } from "@hyperion/contracts";
import type { ColumnsType } from "antd/es/table";
import { useTenantsQuery } from "./api";
import { OnboardTenantModal } from "./OnboardTenantModal";
import { TenantDetailDrawer } from "./TenantDetailDrawer";

const STATUS_COLOR: Record<TenantStatus, string> = {
  active: "success",
  provisioning: "processing",
  suspended: "error",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const columns: ColumnsType<TenantListItem> = [
  { title: "Name", dataIndex: "name", key: "name", sorter: (a, b) => a.name.localeCompare(b.name) },
  { title: "Slug", dataIndex: "slug", key: "slug", sorter: (a, b) => a.slug.localeCompare(b.slug) },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    filters: [
      { text: "Active", value: "active" },
      { text: "Provisioning", value: "provisioning" },
      { text: "Suspended", value: "suspended" },
    ],
    onFilter: (value, record) => record.status === value,
    render: (status: TenantStatus) => <Tag color={STATUS_COLOR[status]}>{status.toUpperCase()}</Tag>,
  },
  {
    title: "Created",
    dataIndex: "createdAt",
    key: "createdAt",
    sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
    render: formatDate,
  },
  {
    title: "Modules",
    dataIndex: "moduleCount",
    key: "moduleCount",
    sorter: (a, b) => a.moduleCount - b.moduleCount,
  },
  {
    title: "Users",
    dataIndex: "userCount",
    key: "userCount",
    sorter: (a, b) => a.userCount - b.userCount,
  },
];

/** ADM-4 - the tenant list + onboarding entry point. Plain AntD Table, deliberately not apps/web's SchemaTable (that's tenant-scoped and doesn't belong here). */
export function TenantsPage(): ReactElement {
  const { data, isLoading } = useTenantsQuery();
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const tenants = data?.tenants ?? [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Tenants
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOnboardOpen(true)}>
          Onboard tenant
        </Button>
      </div>

      <Table<TenantListItem>
        rowKey="id"
        columns={columns}
        dataSource={tenants}
        loading={isLoading}
        onRow={(record) => ({ onClick: () => setSelectedTenantId(record.id), style: { cursor: "pointer" } })}
        locale={{
          emptyText: (
            <Empty
              description={
                <>
                  No tenants yet —{" "}
                  <Typography.Link onClick={() => setOnboardOpen(true)}>onboard your first</Typography.Link>
                </>
              }
            />
          ),
        }}
      />

      <OnboardTenantModal open={onboardOpen} onClose={() => setOnboardOpen(false)} existingTenants={tenants} />
      <TenantDetailDrawer tenantId={selectedTenantId} onClose={() => setSelectedTenantId(null)} />
    </div>
  );
}
