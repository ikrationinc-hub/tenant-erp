import type { ReactElement } from "react";
import { Outlet } from "react-router-dom";
import { Layout, Typography } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useAppStore } from "../../core/store/app-store";
import { NavigationMenu } from "../../core/navigation/NavigationMenu";
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
          <HeaderBar showSettingsEntry />
        </Header>
        {/* height (not minHeight) + overflowY makes Content its own scroll
            region, distinct from the page/document - a bounded scroll
            container is what lets a descendant's `position: sticky` (e.g.
            SchemaForm's Save bar) actually track the viewport while
            scrolling a long form. Without this, the whole page (sidebar and
            header included) scrolled as one document and sticky only ever
            reached its final resting place at the very end of the content,
            never appearing to "stick" along the way. themeTokens.components.
            Layout.headerHeight (48) is the only other thing consuming
            vertical space in this Layout. */}
        <Content style={{ padding: 16, height: "calc(100vh - 48px)", overflowY: "auto" }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
