import type { ReactElement } from "react";
import { App as AntApp, Alert, Button, Descriptions, Drawer, Popconfirm, Skeleton, Switch, Tag } from "antd";
import type { TenantStatus } from "@hyperion/contracts";
import {
  useReactivateTenantMutation,
  useSetTenantModuleMutation,
  useSuspendTenantMutation,
  useTenantModulesQuery,
  useTenantQuery,
} from "./api";

const STATUS_COLOR: Record<TenantStatus, string> = {
  active: "success",
  provisioning: "processing",
  suspended: "error",
};

interface TenantDetailDrawerProps {
  tenantId: string | null;
  onClose: () => void;
}

/**
 * Metadata, provisioning status, module toggles, and suspend/reactivate -
 * nothing else (ADM-4 task item 4). There is deliberately no button, tab,
 * or link anywhere in here that reads a tenant's business records; that's
 * break-glass territory and out of this app's scope entirely.
 */
export function TenantDetailDrawer({ tenantId, onClose }: TenantDetailDrawerProps): ReactElement {
  const { notification } = AntApp.useApp();
  const tenantQuery = useTenantQuery(tenantId ?? undefined);
  const modulesQuery = useTenantModulesQuery(tenantId ?? undefined);
  const suspendMutation = useSuspendTenantMutation(tenantId ?? "");
  const reactivateMutation = useReactivateTenantMutation(tenantId ?? "");
  const setModuleMutation = useSetTenantModuleMutation(tenantId ?? "");

  const tenant = tenantQuery.data;

  async function handleSuspend(): Promise<void> {
    await suspendMutation.mutateAsync();
    notification.success({ message: "Tenant suspended" });
  }

  async function handleReactivate(): Promise<void> {
    await reactivateMutation.mutateAsync();
    notification.success({ message: "Tenant reactivated" });
  }

  return (
    <Drawer title={tenant?.name ?? "Tenant"} open={tenantId !== null} onClose={onClose} width={480}>
      {tenantQuery.isError ? (
        <Alert type="error" showIcon message="Failed to load tenant" description={tenantQuery.error.message} />
      ) : tenantQuery.isLoading || !tenant ? (
        <Skeleton active />
      ) : (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Slug">{tenant.slug}</Descriptions.Item>
            <Descriptions.Item label="Schema">{tenant.schemaName}</Descriptions.Item>
            <Descriptions.Item label="Status">
              <Tag color={STATUS_COLOR[tenant.status]}>{tenant.status.toUpperCase()}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Created">
              {new Date(tenant.createdAt).toLocaleString()}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 16 }}>
            {tenant.status === "active" && (
              <Popconfirm
                title="Suspend this tenant?"
                description="Its users will be unable to log in until reactivated."
                onConfirm={() => void handleSuspend()}
                okText="Yes, suspend"
                cancelText="Cancel"
                okButtonProps={{ danger: true }}
              >
                <Button danger loading={suspendMutation.isPending}>
                  Suspend
                </Button>
              </Popconfirm>
            )}
            {tenant.status === "suspended" && (
              <Popconfirm
                title="Reactivate this tenant?"
                onConfirm={() => void handleReactivate()}
                okText="Yes, reactivate"
                cancelText="Cancel"
              >
                <Button type="primary" loading={reactivateMutation.isPending}>
                  Reactivate
                </Button>
              </Popconfirm>
            )}
          </div>

          <div style={{ marginTop: 24 }}>
            <h4>Modules</h4>
            <Skeleton active loading={modulesQuery.isLoading}>
              {modulesQuery.data?.modules.map((module) => (
                <div
                  key={module.key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 0",
                    borderBottom: "1px solid #f0f0f0",
                  }}
                >
                  <span>{module.name}</span>
                  <Switch
                    checked={module.enabled}
                    loading={setModuleMutation.isPending}
                    onChange={(enabled) =>
                      void setModuleMutation.mutateAsync({ moduleKey: module.key, enabled })
                    }
                  />
                </div>
              ))}
            </Skeleton>
          </div>
        </>
      )}
    </Drawer>
  );
}
