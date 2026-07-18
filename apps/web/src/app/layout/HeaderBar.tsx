import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Dropdown, Space, Typography } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { useLogoutMutation } from "../../modules/auth/api";
import { queryClient } from "../../core/api/query-client";
import { useAppStore } from "../../core/store/app-store";
import { CompanyBranchSwitcher } from "./CompanyBranchSwitcher";

export function HeaderBar(): ReactElement {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const clearAuth = useAppStore((s) => s.clearAuth);
  const logoutMutation = useLogoutMutation();

  async function handleLogout(): Promise<void> {
    try {
      await logoutMutation.mutateAsync();
    } finally {
      clearAuth();
      queryClient.clear();
      void navigate("/login", { replace: true });
    }
  }

  return (
    <Space size="middle">
      <CompanyBranchSwitcher />
      <Dropdown
        menu={{
          items: [{ key: "logout", label: "Log out", onClick: () => void handleLogout() }],
        }}
        placement="bottomRight"
      >
        <Space style={{ cursor: "pointer" }} data-testid="user-menu-trigger">
          <Avatar size="small" icon={<UserOutlined />} />
          <Typography.Text>{user?.name}</Typography.Text>
        </Space>
      </Dropdown>
    </Space>
  );
}
