import type { ReactElement } from "react";
import { Typography } from "antd";
import { SchemaTable } from "../../core/schema-table/SchemaTable";
import { DEV_ENTITY_LIST_ENDPOINT, schemaTableDevFieldDefinitions } from "../../core/schema-table/dev-fixture";

/** Storybook-free renderer check (FE-4), same pattern as /_dev/schema-form (FE-3) - never shipped in a production build (see routes.tsx). */
export function SchemaTableDevPage(): ReactElement {
  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={3}>Schema Table — dev fixture</Typography.Title>
      <Typography.Paragraph type="secondary">
        Columns from GET /field-definitions/_dev/schema-table-showcase; rows from a 47-row mock list at{" "}
        {DEV_ENTITY_LIST_ENDPOINT}, paginated/sorted/filtered server-side by MSW.
      </Typography.Paragraph>
      <SchemaTable
        module={schemaTableDevFieldDefinitions.module}
        entity={schemaTableDevFieldDefinitions.entity}
        endpoint={DEV_ENTITY_LIST_ENDPOINT}
        filters={[{ key: "isActive", label: "Active", type: "boolean" }]}
        actions={[
          { key: "edit", label: "Edit", onClick: () => undefined },
          { key: "deactivate", label: "Deactivate", danger: true, onClick: () => undefined },
        ]}
      />
    </div>
  );
}
