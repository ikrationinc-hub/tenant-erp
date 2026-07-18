import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";
import { Layout, Menu, Typography } from "antd";
import { useAppStore } from "../../core/store/app-store";
import { HeaderBar } from "./HeaderBar";

const { Sider, Header, Content } = Layout;

/** Dense trading-desk chrome, not a marketing site. Nav is intentionally empty - GET /menus wires it up in FE-4 (frontend rule 2). */
export function AppShell(): ReactElement {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider collapsible collapsed={sidebarCollapsed} onCollapse={setSidebarCollapsed} theme="light">
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
          }}
        >
          {sidebarCollapsed ? "H" : "Hyperion"}
        </div>
        <Menu mode="inline" items={[]} />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Typography.Text strong>Hyperion ERP</Typography.Text>
          <HeaderBar />
        </Header>
        <Content style={{ padding: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
