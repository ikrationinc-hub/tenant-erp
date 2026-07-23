import type { ReactElement } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiFetch } from "../../core/api/client";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { Can } from "../../core/permissions/Can";
import type { EntityRow } from "../../core/schema-table/types";

export interface MasterScreenProps {
  module: string;
  entity: string;
  /** The REST path segment (e.g. "countries") - not always `entity` (e.g. "country") pluralized: core/masters/registry.ts on the backend keeps these deliberately distinct (urlSegment for the REST path, entity for field-definitions/permissions), and doesn't expose the mapping over GET /menus. */
  urlSegment: string;
  label: string;
}

type DrawerState = { mode: "create" } | { mode: "edit"; row: EntityRow } | null;

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/**
 * ONE generic master screen (FE-5): SchemaTable (list, search,
 * activate/deactivate) + SchemaForm (create/edit) in a Drawer, over the
 * real generic masters CRUD (core/masters/factory.ts on the backend). A
 * 16th master needs zero new components here - only a registry entry
 * (master-registry.ts) supplying its module/entity/urlSegment/label.
 */
export function MasterScreen({ module, entity, urlSegment, label }: MasterScreenProps): ReactElement {
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const endpoint = `/masters/${urlSegment}`;

  function refreshList(): void {
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoint] });
  }

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    if (drawer?.mode === "edit") {
      await apiFetch(`${endpoint}/${rowId(drawer.row)}`, { method: "PATCH", body: values });
      void message.success(`${label} updated`);
    } else {
      await apiFetch(endpoint, { method: "POST", body: values });
      void message.success(`${label} created`);
    }
    setDrawer(null);
    refreshList();
  }

  async function setActive(row: EntityRow, isActive: boolean): Promise<void> {
    await apiFetch(`${endpoint}/${rowId(row)}/${isActive ? "activate" : "deactivate"}`, { method: "PATCH" });
    void message.success(`${label} ${isActive ? "activated" : "deactivated"}`);
    refreshList();
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {label}
        </Typography.Title>
        <Can permission={`masters.${entity}.create`}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: "create" })}>
            New {label}
          </Button>
        </Can>
      </Space>

      <SchemaTable
        module={module}
        entity={entity}
        endpoint={endpoint}
        filters={[{ key: "isActive", label: "Active", type: "boolean" }]}
        actions={[
          {
            key: "edit",
            label: "Edit",
            permission: `masters.${entity}.update`,
            onClick: (row) => setDrawer({ mode: "edit", row }),
          },
          {
            key: "deactivate",
            label: "Deactivate",
            permission: `masters.${entity}.update`,
            danger: true,
            isVisible: (row) => row.isActive === true,
            onClick: (row) => void setActive(row, false),
          },
          {
            key: "activate",
            label: "Activate",
            permission: `masters.${entity}.update`,
            isVisible: (row) => row.isActive === false,
            onClick: (row) => void setActive(row, true),
          },
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
          <SchemaForm
            module={module}
            entity={entity}
            mode="edit"
            initialValues={drawer.row}
            onSubmit={handleSubmit}
          />
        )}
      </Drawer>
    </Space>
  );
}
