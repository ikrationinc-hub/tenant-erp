import type { ReactElement } from "react";
import { useState } from "react";
import { Card, Divider, Typography } from "antd";
import { SchemaForm } from "../../core/schema-form/SchemaForm";

/**
 * Storybook-free renderer check (FE-3): every field type from the spec,
 * exercised against MSW, before Purchase (or any real module) exists.
 * DEV-only - see app/routes.tsx, which registers this path only when
 * import.meta.env.DEV is true.
 */
export function SchemaFormDevPage(): ReactElement {
  const [lastSubmitted, setLastSubmitted] = useState<Record<string, unknown> | null>(null);

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <Typography.Title level={3}>Schema Form — dev fixture</Typography.Title>
      <Typography.Paragraph type="secondary">
        Renders all 13 field types from a hand-written fixture via GET /field-definitions/_dev/schema-form-showcase
        (MSW).
      </Typography.Paragraph>
      <SchemaForm
        module="_dev"
        entity="schema-form-showcase"
        mode="create"
        onSubmit={(values) => {
          setLastSubmitted(values);
        }}
      />
      {lastSubmitted && (
        <>
          <Divider />
          <Card size="small" title="Last submitted payload">
            <pre data-testid="submitted-payload" style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(lastSubmitted, null, 2)}
            </pre>
          </Card>
        </>
      )}
    </div>
  );
}
