import type { Key, ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Spin, Transfer, type TransferProps } from "antd";
import { permissionCatalogueResponseSchema, roleGrantedPermissionsResponseSchema } from "@hyperion/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { MENU_TREE_QUERY_KEY } from "../../core/navigation/use-menu-tree";

export interface PermissionAssignmentProps {
  roleId: string;
}

interface PermissionTransferItem {
  key: string;
  title: string;
  description: string;
}

function toStringKeys(keys: readonly Key[]): string[] {
  return keys.filter((key): key is string => typeof key === "string");
}

/**
 * The one genuinely new component (FE-5.5): left = catalogue permissions
 * not yet granted, right = granted, grouped visually by module.entity via
 * sort order (Transfer has no native grouping). Each move grants/revokes
 * immediately (core/rbac/mutations.ts's grant/revokePermissionFromRole are
 * themselves single-permission operations) and invalidates this role's
 * granted-permissions cache plus the CURRENT session's own menu/permission
 * cache - a role change takes effect on the affected user's NEXT request
 * (BE-6 bumps role_version server-side); there's no cross-session cache to
 * reach from here.
 */
export function PermissionAssignment({ roleId }: PermissionAssignmentProps): ReactElement {
  const queryClient = useQueryClient();

  const catalogueQuery = useQuery({
    queryKey: ["permission-catalogue"],
    queryFn: () => apiFetch(endpoints.permissionCatalogue, {}, { schema: permissionCatalogueResponseSchema }),
    staleTime: 5 * 60_000,
  });
  const grantedQuery = useQuery({
    queryKey: ["role-permissions", roleId],
    queryFn: () =>
      apiFetch(endpoints.roleGrantedPermissions(roleId), {}, { schema: roleGrantedPermissionsResponseSchema }),
  });

  if (catalogueQuery.isLoading || grantedQuery.isLoading) {
    return <Spin />;
  }

  const dataSource: PermissionTransferItem[] = [...(catalogueQuery.data?.permissions ?? [])]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((entry) => ({ key: entry.key, title: `${entry.module}.${entry.entity}.${entry.action}`, description: entry.description }));
  const targetKeys = grantedQuery.data?.permissionKeys ?? [];

  async function handleChange(_next: Key[], direction: "left" | "right", moveKeys: Key[]): Promise<void> {
    const keys = toStringKeys(moveKeys);
    if (direction === "right") {
      await Promise.all(
        keys.map((key) =>
          apiFetch(endpoints.grantRolePermission(roleId), { method: "POST", body: { permissionKey: key } }),
        ),
      );
    } else {
      await Promise.all(keys.map((key) => apiFetch(endpoints.revokeRolePermission(roleId, key), { method: "DELETE" })));
    }
    void queryClient.invalidateQueries({ queryKey: ["role-permissions", roleId] });
    void queryClient.invalidateQueries({ queryKey: ["users", "me", "permissions"] });
    void queryClient.invalidateQueries({ queryKey: MENU_TREE_QUERY_KEY });
  }

  const onChange: TransferProps<PermissionTransferItem>["onChange"] = (next, direction, moveKeys) => {
    void handleChange(next, direction, moveKeys);
  };

  return (
    <Transfer<PermissionTransferItem>
      dataSource={dataSource}
      titles={["Available", "Granted"]}
      targetKeys={targetKeys}
      onChange={onChange}
      render={(item) => `${item.title} — ${item.description}`}
      showSearch
      listStyle={{ width: 340, height: 380 }}
    />
  );
}
