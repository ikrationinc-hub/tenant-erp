import type { ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { apiFetch } from "../../core/api/client";
import { RecordScreen } from "../../core/record-screen/RecordScreen";
import type { EntityRow } from "../../core/schema-table/types";

export interface MasterScreenProps {
  module: string;
  entity: string;
  /** The REST path segment (e.g. "countries") - not always `entity` (e.g. "country") pluralized: core/masters/registry.ts on the backend keeps these deliberately distinct (urlSegment for the REST path, entity for field-definitions/permissions), and doesn't expose the mapping over GET /menus. */
  urlSegment: string;
  label: string;
}

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/**
 * ONE generic master screen (FE-5): RecordScreen (list, search, create,
 * edit) plus activate/deactivate, over the real generic masters CRUD
 * (core/masters/factory.ts on the backend). A 16th master needs zero new
 * components here - only a registry entry (master-registry.tsx) supplying
 * its module/entity/urlSegment/label.
 */
export function MasterScreen({ module, entity, urlSegment, label }: MasterScreenProps): ReactElement {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const endpoint = `/masters/${urlSegment}`;

  async function setActive(row: EntityRow, isActive: boolean): Promise<void> {
    await apiFetch(`${endpoint}/${rowId(row)}/${isActive ? "activate" : "deactivate"}`, { method: "PATCH" });
    void message.success(`${label} ${isActive ? "activated" : "deactivated"}`);
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoint] });
  }

  return (
    <RecordScreen
      module={module}
      entity={entity}
      endpoint={endpoint}
      label={label}
      filters={[{ key: "isActive", label: "Active", type: "boolean" }]}
      extraActions={[
        {
          key: "deactivate",
          label: "Deactivate",
          permission: `${module}.${entity}.update`,
          danger: true,
          isVisible: (row) => row.isActive === true,
          onClick: (row) => void setActive(row, false),
        },
        {
          key: "activate",
          label: "Activate",
          permission: `${module}.${entity}.update`,
          isVisible: (row) => row.isActive === false,
          onClick: (row) => void setActive(row, true),
        },
      ]}
    />
  );
}
