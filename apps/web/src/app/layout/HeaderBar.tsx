import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Button, Dropdown, Space, Typography } from "antd";
import { SettingOutlined, UserOutlined } from "@ant-design/icons";
import { useLogoutMutation } from "../../modules/auth/api";
import { queryClient } from "../../core/api/query-client";
import { useAppStore } from "../../core/store/app-store";
import { steelCobalt } from "../../theme/palette";
import { CompanyBranchSwitcher } from "./CompanyBranchSwitcher";

export interface HeaderBarProps {
  /** Shows the Settings gear (top-right, Zoho-style) - only the operate AppShell passes this; SettingsShell already has its own "Close Settings" control and reuses HeaderBar for the company switcher/user menu only. */
  showSettingsEntry?: boolean;
}

export function HeaderBar({ showSettingsEntry = false }: HeaderBarProps): ReactElement {
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
      {showSettingsEntry && (
        <Button
          type="text"
          icon={<SettingOutlined />}
          aria-label="Settings"
          onClick={() => void navigate("/settings")}
        />
      )}
      <Dropdown
        menu={{
          items: [{ key: "logout", label: "Log out", onClick: () => void handleLogout() }],
        }}
        placement="bottomRight"
      >
        <Space style={{ cursor: "pointer" }} data-testid="user-menu-trigger">
          <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: steelCobalt.base }} />
          <Typography.Text>{user?.name}</Typography.Text>
        </Space>
      </Dropdown>
    </Space>
  );
}
