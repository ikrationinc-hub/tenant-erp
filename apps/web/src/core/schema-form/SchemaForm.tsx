import type { ReactElement } from "react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Space, Spin, Form as AntForm } from "antd";
import { fieldDefinitionsResponseSchema, type FieldDefinitionsResponse } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints } from "../api/endpoints";
import { compileValidator } from "./compile-validator";
import { buildDefaultValues } from "./default-values";
import { FieldRenderer } from "./FieldRenderer";
import type { SchemaFormMode } from "./types";

export type { SchemaFormMode } from "./types";

export interface SchemaFormProps {
  module: string;
  entity: string;
  mode: SchemaFormMode;
  initialValues?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
}

/**
 * THE core bet of the project (FE-3): every form in this ERP renders
 * through this component. It fetches the field-definitions schema, compiles
 * it to a Zod validator, and renders sections/fields entirely from that
 * metadata - order, labels, mandatory, visibility, editability. It never
 * decides what to show; the backend already intersected definitions with
 * the caller's field permissions (frontend rule 4).
 */
export function SchemaForm({ module, entity, mode, initialValues, onSubmit }: SchemaFormProps): ReactElement {
  const schemaQuery = useQuery({
    queryKey: ["field-definitions", module, entity],
    queryFn: () =>
      apiFetch(endpoints.fieldDefinitions(module, entity), {}, { schema: fieldDefinitionsResponseSchema }),
  });

  if (schemaQuery.isLoading) {
    return <Spin data-testid="schema-form-loading" />;
  }

  if (schemaQuery.isError || !schemaQuery.data) {
    return <Alert type="error" showIcon message="Could not load the form definition" />;
  }

  return (
    <SchemaFormBody schema={schemaQuery.data} mode={mode} initialValues={initialValues} onSubmit={onSubmit} />
  );
}

function SchemaFormBody({
  schema,
  mode,
  initialValues,
  onSubmit,
}: {
  schema: FieldDefinitionsResponse;
  mode: SchemaFormMode;
  initialValues: Record<string, unknown> | undefined;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
}): ReactElement {
  const validator = useMemo(() => compileValidator(schema), [schema]);
  const defaultValues = useMemo(
    () => buildDefaultValues(schema, initialValues),
    // initialValues is re-created per render at most call sites; the schema
    // (module/entity/version) is the thing that should actually drive a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema],
  );

  const { control, handleSubmit } = useForm<Record<string, unknown>>({
    resolver: zodResolver(validator),
    defaultValues,
  });

  const submit = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  const sortedSections = [...schema.sections].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <AntForm layout="vertical" onFinish={() => void submit()}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {sortedSections.map((section) => (
          <Card key={section.key} title={section.label} size="small">
            {[...section.fields]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((field) => (
                <FieldRenderer key={field.fieldKey} field={field} control={control} mode={mode} />
              ))}
          </Card>
        ))}
        {mode !== "view" && (
          <Button type="primary" htmlType="submit">
            Save
          </Button>
        )}
      </Space>
    </AntForm>
  );
}
