import type { EffectiveField } from "./types.js";

/**
 * A form section's code-declared identity - label/description/sortOrder,
 * never a field_definitions row (same "code-declared, not company-
 * overridable" treatment as FieldDefault's own fieldType/allowCreate).
 * Declared per (module, entity) in defaults.ts's SECTION_DEFAULTS; a field
 * opts in by setting its own `section` to one of these keys.
 */
export interface FieldSectionDefault {
  module: string;
  entity: string;
  key: string;
  label: string;
  description?: string;
  sortOrder: number;
}

export interface FieldSectionGroup {
  key: string;
  label: string;
  description?: string;
  sortOrder: number;
  fields: EffectiveField[];
}

/**
 * Groups already-resolved fields by their declared `section`, in section
 * sortOrder (fields keep whatever order resolveBaseFieldDefinitions
 * already sorted them into). Returns undefined - not an empty array - when
 * `sections` is empty, so a caller can tell "not split into sections yet"
 * apart from "split into zero sections", and fall back to the flat
 * `fields` response every other module/entity already returns.
 */
export function groupFieldsIntoSections(
  sections: FieldSectionDefault[],
  fields: EffectiveField[],
): FieldSectionGroup[] | undefined {
  if (sections.length === 0) {
    return undefined;
  }

  const grouped = new Map<string, EffectiveField[]>();
  for (const field of fields) {
    if (!field.section) {
      continue;
    }
    const list = grouped.get(field.section);
    if (list) {
      list.push(field);
    } else {
      grouped.set(field.section, [field]);
    }
  }

  return [...sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((section) => ({
      key: section.key,
      label: section.label,
      ...(section.description ? { description: section.description } : {}),
      sortOrder: section.sortOrder,
      fields: grouped.get(section.key) ?? [],
    }));
}
