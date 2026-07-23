import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Space, Tag, Typography } from "antd";
import { PlusOutlined, UserAddOutlined } from "@ant-design/icons";
import { masterOptionsResponseSchema, resendInvitationResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import type { EntityRow } from "../../core/schema-table/types";
import { InviteUserDrawer } from "./InviteUserDrawer";
import { ProvisionUserDrawer } from "./ProvisionUserDrawer";
import { EditUserRolesModal } from "./EditUserRolesModal";

const STATUS_COLOR: Record<string, string> = {
  invited: "gold",
  active: "green",
  suspended: "red",
};

function statusLabel(row: EntityRow): string {
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "invited") {
    return "Invited (pending)";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function StatusCell({ row }: { row: EntityRow }): ReactElement {
  const status = typeof row.status === "string" ? row.status : "";
  const expiresAt = typeof row.invitationExpiresAt === "string" ? row.invitationExpiresAt : undefined;
  return (
    <Space direction="vertical" size={0}>
      <Tag color={STATUS_COLOR[status] ?? "default"}>{statusLabel(row)}</Tag>
      {status === "invited" && expiresAt && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Expires {new Date(expiresAt).toLocaleDateString()}
        </Typography.Text>
      )}
    </Space>
  );
}

/**
 * The demo centrepiece (FE-5.5): SchemaTable over /users (columns from
 * field-definitions, filtered by status/role) plus the invite/provision
 * drawers and per-row lifecycle actions. Every action is gated by
 * permission via <Can/> (SchemaTable's own action.permission), never an
 * inline role check (backend rule / CLAUDE.md "Do not" list).
 */
export function UserManagementScreen(): ReactElement {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [editRolesRow, setEditRolesRow] = useState<EntityRow | null>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const roleOptionsQuery = useQuery({
    queryKey: ["field-options", "roles", "", ""],
    queryFn: () => apiFetch(`${endpoints.roles}/options`, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });

  function refreshList(): void {
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.users] });
  }

  async function resend(row: EntityRow): Promise<void> {
    const invitationId = typeof row.invitationId === "string" ? row.invitationId : "";
    const result = await apiFetch(
      endpoints.resendInvitation(invitationId),
      { method: "POST" },
      { schema: resendInvitationResponseSchema },
    );
    void message.success(`Invitation resent - expires ${new Date(result.expiresAt).toLocaleDateString()}`);
    refreshList();
  }

  async function revoke(row: EntityRow): Promise<void> {
    const invitationId = typeof row.invitationId === "string" ? row.invitationId : "";
    await apiFetch(endpoints.revokeInvitation(invitationId), { method: "POST" });
    void message.success("Invitation revoked");
    refreshList();
  }

  async function suspend(row: EntityRow): Promise<void> {
    const id = typeof row.id === "string" ? row.id : "";
    await apiFetch(endpoints.suspendUser(id), { method: "PATCH" });
    void message.success("User suspended");
    refreshList();
  }

  async function reactivate(row: EntityRow): Promise<void> {
    const id = typeof row.id === "string" ? row.id : "";
    await apiFetch(endpoints.reactivateUser(id), { method: "PATCH" });
    void message.success("User reactivated");
    refreshList();
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Users
        </Typography.Title>
        <Space>
          <Button icon={<UserAddOutlined />} onClick={() => setProvisionOpen(true)}>
            Provision (no email)
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setInviteOpen(true)}>
            Invite User
          </Button>
        </Space>
      </Space>

      <SchemaTable
        module="users"
        entity="user"
        endpoint={endpoints.users}
        columns={[{ fieldKey: "status", render: (_value: unknown, row: EntityRow) => <StatusCell row={row} /> }]}
        filters={[
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { label: "Invited", value: "invited" },
              { label: "Active", value: "active" },
              { label: "Suspended", value: "suspended" },
            ],
          },
          {
            key: "roleId",
            label: "Role",
            type: "select",
            options: (roleOptionsQuery.data?.options ?? []).map((option) => ({
              label: option.label,
              value: option.value,
            })),
          },
        ]}
        actions={[
          {
            key: "resend",
            label: "Resend",
            permission: "users.user.create",
            isVisible: (row) => row.status === "invited",
            onClick: (row) => void resend(row),
          },
          {
            key: "revoke",
            label: "Revoke",
            permission: "users.user.create",
            danger: true,
            isVisible: (row) => row.status === "invited",
            onClick: (row) => void revoke(row),
          },
          {
            key: "suspend",
            label: "Suspend",
            permission: "users.user.update",
            danger: true,
            isVisible: (row) => row.status === "active",
            onClick: (row) => void suspend(row),
          },
          {
            key: "reactivate",
            label: "Reactivate",
            permission: "users.user.update",
            isVisible: (row) => row.status === "suspended",
            onClick: (row) => void reactivate(row),
          },
          {
            key: "edit-roles",
            label: "Edit roles",
            permission: "users.user.update",
            onClick: (row) => setEditRolesRow(row),
          },
        ]}
      />

      <InviteUserDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ProvisionUserDrawer open={provisionOpen} onClose={() => setProvisionOpen(false)} />
      <EditUserRolesModal row={editRolesRow} onClose={() => setEditRolesRow(null)} />
    </Space>
  );
}
