import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";
import { Layout, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useAppStore } from "../../core/store/app-store";
import { NavigationMenu } from "../../core/navigation/NavigationMenu";
import { MenuBreadcrumbs } from "../../core/navigation/MenuBreadcrumbs";
import { sider, slate } from "../../theme/palette";
import { HeaderBar } from "./HeaderBar";

const { Sider, Header, Content } = Layout;

/** Dense trading-desk chrome, not a marketing site. Nav renders GET /menus (frontend rule 2, FE-4). */
export function AppShell(): ReactElement {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        theme="dark"
        trigger={null}
        style={{ borderRight: `1px solid ${sider.border}` }}
      >
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            padding: sidebarCollapsed ? 0 : "0 12px 0 16px",
            borderBottom: `1px solid ${sider.border}`,
          }}
        >
          {!sidebarCollapsed && (
            <span
              style={{
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: "0.02em",
                color: sider.logoText,
              }}
            >
              Ikration
            </span>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              background: "transparent",
              border: "none",
              display: "flex",
              alignItems: "center",
              padding: 6,
              fontSize: 15,
              color: sider.textSecondary,
              cursor: "pointer",
            }}
          >
            {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>
        <NavigationMenu />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${slate[200]}`,
            boxShadow: "0 2px 6px rgba(15, 23, 42, 0.10)",
            zIndex: 1,
          }}
        >
          <Typography.Text strong>Ikration ERP</Typography.Text>
          <HeaderBar />
        </Header>
        <Content style={{ padding: 16 }}>
          <MenuBreadcrumbs />
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
