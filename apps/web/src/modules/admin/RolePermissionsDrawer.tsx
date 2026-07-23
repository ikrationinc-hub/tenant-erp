import type { ReactElement } from "react";
import { Drawer, Divider, Typography } from "antd";
import type { EntityRow } from "../../core/schema-table/types";
import { PermissionAssignment } from "./PermissionAssignment";
import { FieldPermissionMatrix } from "./FieldPermissionMatrix";

export interface RolePermissionsDrawerProps {
  role: EntityRow | null;
  onClose: () => void;
}

function roleName(role: EntityRow | null): string {
  return role && typeof role.name === "string" ? role.name : "";
}

function roleId(role: EntityRow | null): string {
  return role && typeof role.id === "string" ? role.id : "";
}

/** A Drawer, not a `/roles/:id` route - DynamicRoutes only resolves exact, static menu-tree paths (frontend rule 2); a role id is dynamic, so this stays a same-page overlay like every other create/edit flow in this app. */
export function RolePermissionsDrawer({ role, onClose }: RolePermissionsDrawerProps): ReactElement {
  const id = roleId(role);

  return (
    <Drawer title={`${roleName(role)} — permissions`} open={role !== null} onClose={onClose} width={720} destroyOnHidden>
      {role && (
        <>
          <Typography.Title level={5}>Permissions</Typography.Title>
          <PermissionAssignment roleId={id} />
          <Divider />
          <Typography.Title level={5}>Field permissions</Typography.Title>
          <FieldPermissionMatrix roleId={id} />
        </>
      )}
    </Drawer>
  );
}
