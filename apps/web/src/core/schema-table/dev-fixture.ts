import { fieldDefinitionsResponseSchema, type FieldDefinitionsResponse } from "@hyperion/contracts";

export const DEV_ENTITY_LIST_ENDPOINT = "/_dev/entities";

/** Hand-written fixture for the /_dev/schema-table dev route and the SchemaTable test suite - mirrors the dev-fixture pattern established in core/schema-form/dev-fixture.ts (FE-3). */
export const schemaTableDevFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "_dev",
  entity: "schema-table-showcase",
  version: 1,
  sections: [
    {
      key: "section",
      label: "Section",
      sortOrder: 1,
      fields: [
        {
          fieldKey: "code",
          tier: "fixed",
          label: "Code",
          fieldType: "Textbox",
          dataType: "string",
          isMandatory: true,
          isEditable: true,
          isSystem: true,
          sortOrder: 1,
        },
        {
          fieldKey: "name",
          tier: "fixed",
          label: "Name",
          fieldType: "Textbox",
          dataType: "string",
          isMandatory: true,
          isEditable: true,
          isSystem: true,
          sortOrder: 2,
        },
        {
          fieldKey: "isActive",
          tier: "fixed",
          label: "Active",
          fieldType: "Toggle",
          dataType: "boolean",
          isMandatory: false,
          isEditable: true,
          isSystem: false,
          sortOrder: 3,
        },
      ],
    },
  ],
});

export interface DevEntityRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const ROW_COUNT = 47;

export const schemaTableDevRows: DevEntityRow[] = Array.from({ length: ROW_COUNT }, (_, index) => ({
  id: `row-${index + 1}`,
  code: `CODE-${String(index + 1).padStart(3, "0")}`,
  name: `Sample Record ${index + 1}`,
  isActive: index % 3 !== 0,
}));
