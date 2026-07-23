import type { FieldDefinitionsResponse, FieldSection } from "@hyperion/contracts";

/**
 * The real field-engine's response is flat (`fields`, no sections); FE-3's
 * dev fixtures are section-grouped (`sections`). Every consumer
 * (SchemaForm, FieldRenderer, compile-validator, SchemaTable's
 * columns-from-fields) reads through this so both shapes render
 * identically - a flat response becomes one implicit, unlabeled section.
 *
 * `isVisible` is filtered here too: unlike FE-3's fixtures (an invisible
 * field is simply absent), the real field-engine sends
 * `isVisible: false` instead of omitting the field - this is the one
 * place that turns "flagged invisible" into "not rendered" (frontend rule
 * 4 - obeying the metadata, not re-deriving a permission decision).
 */
export function resolveFieldSections(schema: FieldDefinitionsResponse): FieldSection[] {
  const rawSections = schema.sections ?? [
    { key: "default", label: "", sortOrder: 0, fields: schema.fields ?? [] },
  ];

  return [...rawSections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => ({
      ...section,
      fields: [...section.fields]
        .filter((field) => field.isVisible !== false)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}
