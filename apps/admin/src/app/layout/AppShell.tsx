import type { ReactElement } from "react";
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ApartmentOutlined, HeartOutlined } from "@ant-design/icons";
import { Layout, Menu, Typography } from "antd";
import { HeaderBar } from "./HeaderBar";

const { Sider, Header, Content } = Layout;

/**
 * Sidebar with exactly two items - Tenants, Health (ADM-3 task item 6). No
 * company/branch switcher (meaningless for a platform-scoped operator) and,
 * unlike apps/web's shell, this nav is a fixed pair, not rendered from
 * GET /menus - the tenant "never hardcode navigation" rule (CLAUDE.md
 * frontend rule 2) governs the tenant app's business menu, not this
 * two-item ops console.
 */
export function AppShell(): ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    { key: "/tenants", icon: <ApartmentOutlined />, label: "Tenants" },
    { key: "/health", icon: <HeartOutlined />, label: "Health" },
  ];

  const selectedKey = items.find((item) => location.pathname.startsWith(item.key))?.key ?? "/tenants";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            color: "#fff",
          }}
        >
          {collapsed ? "H" : "Hyperion Platform"}
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={({ key }) => void navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #1e293b",
          }}
        >
          <Typography.Text strong style={{ color: "#fff" }}>
            Hyperion Platform Console
          </Typography.Text>
          <HeaderBar />
        </Header>
        <Content style={{ padding: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
