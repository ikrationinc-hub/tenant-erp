import { describe, expect, it } from "vitest";
import { FIELD_DEFAULTS } from "../defaults.js";

/**
 * Pure unit test, no DB - the class of bug this guards against
 * (core/field-engine/defaults.ts's own doc history) is a `dataType:
 * "select"` field with nothing to select from: apps/web renders an
 * empty "No data" dropdown, and nothing here ever caught it because
 * every other test either schema-validates a response shape or exercises
 * one specific entity, never all of FIELD_DEFAULTS at once.
 */
describe("core/field-engine/defaults - every select field has an optionsSource", () => {
  it("no FIELD_DEFAULTS entry has dataType 'select' without a non-empty optionsSource", () => {
    const offenders = FIELD_DEFAULTS.filter((field) => {
      if (field.dataType !== "select") {
        return false;
      }
      const source = field.optionsSource;
      if (source === undefined) {
        return true;
      }
      if (typeof source === "string") {
        return source.length === 0;
      }
      return source.staticOptions.length === 0;
    }).map((field) => `${field.module}/${field.entity}.${field.fieldKey}`);

    expect(offenders).toEqual([]);
  });

  it("every static/enum optionsSource's values are unique and non-empty", () => {
    const problems: string[] = [];
    for (const field of FIELD_DEFAULTS) {
      const source = field.optionsSource;
      if (source === undefined || typeof source === "string") {
        continue;
      }
      const values = source.staticOptions.map((option) => option.value);
      const hasEmpty = source.staticOptions.some((option) => option.value.length === 0 || option.label.length === 0);
      const hasDuplicates = new Set(values).size !== values.length;
      if (hasEmpty || hasDuplicates) {
        problems.push(`${field.module}/${field.entity}.${field.fieldKey}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
