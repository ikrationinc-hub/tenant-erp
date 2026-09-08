import type { Control } from "react-hook-form";
import type { FieldDefinition } from "@ikration/contracts";

export interface UploadContext {
  entity: string;
  entityId: string;
}

/** Every field-type component gets exactly this - the registry (registry.ts) is the only place that knows which component goes with which type (frontend rule 6). `uploadContext` is only meaningful to FileUpload/MultiUpload - undefined means "no real record to attach to yet" (e.g. create mode), and those two fall back to local-only tracking. */
export interface FieldComponentProps {
  field: FieldDefinition;
  control: Control<Record<string, unknown>>;
  readOnly: boolean;
  uploadContext?: UploadContext;
  /** The form's own module/entity (e.g. "masters"/"country") - lets a field type special-case behavior by identity (TextboxField's Generate button on masters' `code` field) without a new field-definition config flag. */
  module: string;
  entity: string;
  /** The REST endpoint this record lives at (e.g. "/masters/countries"), when the caller supplied one (SchemaFormProps.endpoint) - undefined for forms that don't pass it. Lets a field type build a sibling request (TextboxField's suggest-code call) without needing to know the entity->urlSegment mapping, which is modules/masters' concern, not core/schema-form's. */
  endpoint: string | undefined;
}
