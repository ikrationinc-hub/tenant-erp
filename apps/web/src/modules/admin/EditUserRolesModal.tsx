import type { ReactElement } from "react";
import { App as AntApp, Modal } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import type { EntityRow } from "../../core/schema-table/types";

export interface EditUserRolesModalProps {
  row: EntityRow | null;
  onClose: () => void;
}

function rowId(row: EntityRow): string {
  return typeof row.id === "string" ? row.id : "";
}

/** module="users" entity="edit-roles" has exactly one field-definition: a multi-select "roleIds" Dropdown - still schema-driven, not a hand-built control. */
export function EditUserRolesModal({ row, onClose }: EditUserRolesModalProps): ReactElement {
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    if (!row) {
      return;
    }
    await apiFetch(endpoints.setUserRoles(rowId(row)), { method: "PUT", body: values });
    void message.success("Roles updated");
    onClose();
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.users] });
  }

  return (
    <Modal title="Edit roles" open={row !== null} onCancel={onClose} footer={null} destroyOnHidden>
      {row && (
        <SchemaForm
          module="users"
          entity="edit-roles"
          mode="edit"
          initialValues={{ roleIds: row.roleIds ?? [] }}
          onSubmit={handleSubmit}
        />
      )}
    </Modal>
  );
}
