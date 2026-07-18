import type { ReactElement } from "react";
import { Empty, Typography } from "antd";

/** Placeholder landing for the Tenants nav item - the list/onboarding/detail UI is ADM-4's scope, not this scaffold's. */
export function TenantsPage(): ReactElement {
  return (
    <div>
      <Typography.Title level={4}>Tenants</Typography.Title>
      <Empty description="Tenant list and onboarding land here in ADM-4." />
    </div>
  );
}
