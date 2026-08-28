import type { ReactElement } from "react";
import { Link, Outlet } from "react-router-dom";
import { Button, Layout, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { SettingsNav } from "../../core/navigation/SettingsNav";
import { sider, slate } from "../../theme/palette";
import { HeaderBar } from "./HeaderBar";

const { Sider, Header, Content } = Layout;

/**
 * The Settings area's own shell - same three-region Layout as AppShell
 * (sider + header + content) and the SAME dark gunmetal sider palette (not
 * a lighter "settings" look-and-feel of its own) - this is still the one
 * app, just a different nav tree and a "Close Settings" control instead of
 * the app brand/gear.
 */
export function SettingsShell(): ReactElement {
  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={230} theme="dark" style={{ borderRight: `1px solid ${sider.border}` }}>
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            borderBottom: `1px solid ${sider.border}`,
          }}
        >
          <Typography.Text strong style={{ fontSize: 15, color: sider.logoText }}>
            Settings
          </Typography.Text>
        </div>
        <SettingsNav />
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
            background: "#fff",
          }}
        >
          <div>
            <Typography.Text strong>All Settings</Typography.Text>
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              Ikration ERP
            </Typography.Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link to="/">
              <Button icon={<CloseOutlined />}>Close Settings</Button>
            </Link>
            <HeaderBar />
          </div>
        </Header>
        <Content style={{ padding: 16, height: "calc(100vh - 48px)", overflowY: "auto" }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
