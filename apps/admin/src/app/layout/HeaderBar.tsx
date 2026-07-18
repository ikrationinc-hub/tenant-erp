import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Dropdown, Space, Tag, Typography } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { usePlatformLogoutMutation } from "../../modules/auth/api";
import { queryClient } from "../../core/api/query-client";
import { useAdminStore } from "../../core/store/admin-store";
import { PLATFORM_ACCENT_COLOR } from "../../theme/tokens";

export function HeaderBar(): ReactElement {
  const navigate = useNavigate();
  const admin = useAdminStore((s) => s.admin);
  const clearAuth = useAdminStore((s) => s.clearAuth);
  const logoutMutation = usePlatformLogoutMutation();

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
      <Tag color={PLATFORM_ACCENT_COLOR}>PLATFORM ADMIN</Tag>
      <Dropdown
        menu={{
          items: [{ key: "logout", label: "Log out", onClick: () => void handleLogout() }],
        }}
        placement="bottomRight"
      >
        <Space style={{ cursor: "pointer" }} data-testid="user-menu-trigger">
          <Avatar size="small" icon={<UserOutlined />} />
          <Typography.Text style={{ color: "#fff" }}>{admin?.name}</Typography.Text>
        </Space>
      </Dropdown>
    </Space>
  );
}
