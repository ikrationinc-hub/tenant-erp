import type { ReactElement } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiFetch } from "../api/client";
import { SchemaTable } from "../schema-table/SchemaTable";
import { SchemaForm } from "../schema-form/SchemaForm";
import { Can } from "../permissions/Can";
import type { EntityRow, SchemaTableAction, SchemaTableFilter } from "../schema-table/types";

export interface RecordScreenProps {
  module: string;
  entity: string;
  /** The real list/create/update REST path, e.g. "/companies" or "/masters/countries" - not derived from module/entity, since backend list routes don't share one URL shape (see SchemaTableProps' own doc comment). */
  endpoint: string;
  label: string;
  filters?: SchemaTableFilter[];
  /** Extra row actions beyond the built-in "Edit", e.g. MasterScreen's activate/deactivate. */
  extraActions?: SchemaTableAction[];
}

type DrawerState = { mode: "create" } | { mode: "edit"; row: EntityRow } | null;

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/**
 * The generic list+create+edit shape shared by every schema-driven admin
 * screen (FE-5's masters, FE-5.5's companies/branches/roles): SchemaTable
 * for the list, SchemaForm-in-a-Drawer for create/edit. Permission keys
 * follow the same `${module}.${entity}.create`/`.update` convention the
 * backend's permissionEntry() uses everywhere (core/rbac/types.ts).
 * MasterScreen wraps this, adding activate/deactivate as `extraActions`.
 */
export function RecordScreen({ module, entity, endpoint, label, filters, extraActions = [] }: RecordScreenProps): ReactElement {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    if (drawer?.mode === "edit") {
      await apiFetch(`${endpoint}/${rowId(drawer.row)}`, { method: "PATCH", body: values });
      void message.success(`${label} updated`);
    } else {
      await apiFetch(endpoint, { method: "POST", body: values });
      void message.success(`${label} created`);
    }
    setDrawer(null);
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoint] });
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {label}
        </Typography.Title>
        <Can permission={`${module}.${entity}.create`}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: "create" })}>
            New {label}
          </Button>
        </Can>
      </Space>

      <SchemaTable
        module={module}
        entity={entity}
        endpoint={endpoint}
        {...(filters ? { filters } : {})}
        actions={[
          {
            key: "edit",
            label: "Edit",
            permission: `${module}.${entity}.update`,
            onClick: (row) => setDrawer({ mode: "edit", row }),
          },
          ...extraActions,
        ]}
      />

      <Drawer
        title={drawer?.mode === "edit" ? `Edit ${label}` : `New ${label}`}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={480}
        destroyOnHidden
      >
        {drawer?.mode === "create" && (
          <SchemaForm module={module} entity={entity} mode="create" onSubmit={handleSubmit} />
        )}
        {drawer?.mode === "edit" && (
          <SchemaForm module={module} entity={entity} mode="edit" initialValues={drawer.row} onSubmit={handleSubmit} />
        )}
      </Drawer>
    </Space>
  );
}
