import type { ReactElement } from "react";
import { Empty, Typography } from "antd";

/** Placeholder landing for the Health nav item - the health dashboard is ADM-5's scope, not this scaffold's. */
export function HealthPage(): ReactElement {
  return (
    <div>
      <Typography.Title level={4}>Health</Typography.Title>
      <Empty description="Platform + per-tenant health status lands here in ADM-5." />
    </div>
  );
}
