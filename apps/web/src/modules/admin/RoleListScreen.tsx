import type { ReactElement } from "react";
import { useState } from "react";
import { RecordScreen } from "../../core/record-screen/RecordScreen";
import type { EntityRow } from "../../core/schema-table/types";
import { RolePermissionsDrawer } from "./RolePermissionsDrawer";

/** Role list + create/rename via RecordScreen (requirement 9); "Permissions" is the one extra action opening the genuinely new component (requirements 10-11). */
export function RoleListScreen(): ReactElement {
  const [permissionsRole, setPermissionsRole] = useState<EntityRow | null>(null);

  return (
    <>
      <RecordScreen
        module="admin"
        entity="role"
        endpoint="/roles"
        label="Roles"
        extraActions={[
          {
            key: "permissions",
            label: "Permissions",
            permission: "admin.role.update",
            onClick: (row) => setPermissionsRole(row),
          },
        ]}
      />
      <RolePermissionsDrawer role={permissionsRole} onClose={() => setPermissionsRole(null)} />
    </>
  );
}
