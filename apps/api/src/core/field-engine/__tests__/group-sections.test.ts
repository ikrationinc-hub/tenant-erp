import { describe, expect, it } from "vitest";
import type { EffectiveField } from "../types.js";
import type { FieldSectionDefault } from "../group-sections.js";
import { groupFieldsIntoSections } from "../group-sections.js";

function mockField(overrides: Partial<EffectiveField> & Pick<EffectiveField, "fieldKey" | "sortOrder">): EffectiveField {
  return {
    id: undefined,
    module: "test",
    entity: "entity",
    tier: 2,
    label: overrides.fieldKey,
    dataType: "text",
    isVisible: true,
    isMandatory: false,
    isEditable: true,
    defaultValue: undefined,
    optionsSource: undefined,
    fieldType: undefined,
    multiple: undefined,
    allowCreate: undefined,
    validationJson: undefined,
    isSystem: false,
    section: undefined,
    ...overrides,
  };
}

describe("core/field-engine/group-sections", () => {
  it("groups fields into their declared sections, ordered by each section's sortOrder", () => {
    const sections: FieldSectionDefault[] = [
      { module: "test", entity: "entity", key: "s1", label: "S1", sortOrder: 0 },
      { module: "test", entity: "entity", key: "s2", label: "S2", sortOrder: 1 },
    ];
    const fields = [
      mockField({ fieldKey: "a", sortOrder: 0, section: "s2" }),
      mockField({ fieldKey: "b", sortOrder: 1, section: "s1" }),
      mockField({ fieldKey: "c", sortOrder: 2, section: "s1" }),
    ];

    const grouped = groupFieldsIntoSections(sections, fields);

    expect(grouped?.map((s) => s.key)).toEqual(["s1", "s2"]);
    expect(grouped?.[0]?.fields.map((f) => f.fieldKey)).toEqual(["b", "c"]);
    expect(grouped?.[1]?.fields.map((f) => f.fieldKey)).toEqual(["a"]);
  });

  it("returns undefined when no sections are declared - the entity keeps its flat-fields behavior", () => {
    const fields = [mockField({ fieldKey: "a", sortOrder: 0 })];

    expect(groupFieldsIntoSections([], fields)).toBeUndefined();
  });

  it("includes a section's description only when its default provides one", () => {
    const sections: FieldSectionDefault[] = [
      { module: "test", entity: "entity", key: "s1", label: "S1", sortOrder: 0, description: "Has a description" },
      { module: "test", entity: "entity", key: "s2", label: "S2", sortOrder: 1 },
    ];
    const fields = [
      mockField({ fieldKey: "a", sortOrder: 0, section: "s1" }),
      mockField({ fieldKey: "b", sortOrder: 1, section: "s2" }),
    ];

    const grouped = groupFieldsIntoSections(sections, fields);

    expect(grouped?.[0]?.description).toBe("Has a description");
    expect(grouped?.[1]?.description).toBeUndefined();
  });

  it("omits a field from every group when its section key matches nothing declared", () => {
    const sections: FieldSectionDefault[] = [{ module: "test", entity: "entity", key: "s1", label: "S1", sortOrder: 0 }];
    const fields = [
      mockField({ fieldKey: "a", sortOrder: 0, section: "s1" }),
      mockField({ fieldKey: "orphan", sortOrder: 1, section: "unknown-section" }),
      mockField({ fieldKey: "unset", sortOrder: 2 }),
    ];

    const grouped = groupFieldsIntoSections(sections, fields);

    expect(grouped?.[0]?.fields.map((f) => f.fieldKey)).toEqual(["a"]);
  });
});
