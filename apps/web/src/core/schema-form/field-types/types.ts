import type { Control } from "react-hook-form";
import type { FieldDefinition } from "@hyperion/contracts";

/** Every field-type component gets exactly this - the registry (registry.ts) is the only place that knows which component goes with which type (frontend rule 6). */
export interface FieldComponentProps {
  field: FieldDefinition;
  control: Control<Record<string, unknown>>;
  readOnly: boolean;
}
