import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Space, Spin, Form as AntForm } from "antd";
import { fieldDefinitionsResponseSchema, type FieldDefinitionsResponse } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints } from "../api/endpoints";
import { notifyError, toToastPayload } from "../api/error-toast";
import { compileValidator } from "./compile-validator";
import { buildDefaultValues } from "./default-values";
import { FieldRenderer } from "./FieldRenderer";
import type { SchemaFormMode } from "./types";
import type { UploadContext } from "./field-types/types";
import { resolveFieldSections } from "../field-definitions/resolve-sections";

export type { SchemaFormMode } from "./types";

export interface SchemaFormProps {
  module: string;
  entity: string;
  mode: SchemaFormMode;
  initialValues?: Record<string, unknown>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  /** FileUpload/MultiUpload fields need a real entity/entityId to attach to - absent (e.g. create mode, before the record has an id) they fall back to local-only tracking. */
  uploadContext?: UploadContext;
}

/**
 * THE core bet of the project (FE-3): every form in this ERP renders
 * through this component. It fetches the field-definitions schema, compiles
 * it to a Zod validator, and renders sections/fields entirely from that
 * metadata - order, labels, mandatory, visibility, editability. It never
 * decides what to show; the backend already intersected definitions with
 * the caller's field permissions (frontend rule 4).
 */
export function SchemaForm({
  module,
  entity,
  mode,
  initialValues,
  onSubmit,
  uploadContext,
}: SchemaFormProps): ReactElement {
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
    <SchemaFormBody
      schema={schemaQuery.data}
      mode={mode}
      initialValues={initialValues}
      onSubmit={onSubmit}
      uploadContext={uploadContext}
    />
  );
}

function SchemaFormBody({
  schema,
  mode,
  initialValues,
  onSubmit,
  uploadContext,
}: {
  schema: FieldDefinitionsResponse;
  mode: SchemaFormMode;
  initialValues: Record<string, unknown> | undefined;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  uploadContext: UploadContext | undefined;
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      // A plain async handler, not a useMutation - `void submit()` below
      // would otherwise discard the rejection outright and a thrown
      // ApiError (e.g. BE-7's 403 on an approval-holding provisioned role)
      // would never reach the user. Same payload shape as the global toast
      // (query-client.ts), so both channels agree on the same message.
      const payload = toToastPayload(error);
      notifyError(payload);
      setSubmitError(payload.description ?? payload.message);
    }
  });

  const sections = resolveFieldSections(schema);

  return (
    <AntForm layout="vertical" onFinish={() => void submit()}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        {sections.map((section) => (
          <Card key={section.key} title={section.label || undefined} size="small">
            {section.fields.map((field) => (
              <FieldRenderer key={field.fieldKey} field={field} control={control} mode={mode} uploadContext={uploadContext} />
            ))}
          </Card>
        ))}
        {submitError && <Alert type="error" showIcon message={submitError} />}
        {mode !== "view" && (
          <Button type="primary" htmlType="submit">
            Save
          </Button>
        )}
      </Space>
    </AntForm>
  );
}
