import type { Control } from "react-hook-form";
import type { FieldDefinition } from "@hyperion/contracts";

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
}
