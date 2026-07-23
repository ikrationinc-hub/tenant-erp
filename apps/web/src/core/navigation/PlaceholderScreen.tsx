import type { ReactElement } from "react";
import { Card, Typography } from "antd";

/** Every menu-tree path resolves to a real route today, even before its real screen exists - FE-5 (masters) and FE-6 (Supplier/Purchase) replace this per path with a generic SchemaTable/SchemaForm screen. */
export function PlaceholderScreen({ label }: { label: string }): ReactElement {
  return (
    <Card>
      <Typography.Title level={4}>{label}</Typography.Title>
      <Typography.Paragraph type="secondary">
        This screen isn&apos;t built yet - it&apos;s reachable because it&apos;s in your menu.
      </Typography.Paragraph>
    </Card>
  );
}
