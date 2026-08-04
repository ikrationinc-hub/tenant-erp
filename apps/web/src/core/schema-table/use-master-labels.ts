import { useQueries } from "@tanstack/react-query";
import { masterOptionsResponseSchema, type FieldDefinitionsResponse } from "@ikration/contracts";
import { apiFetch } from "../api/client";
import { resolveOptionsEndpoint } from "../schema-form/use-field-options";
import { resolveFieldSections } from "../field-definitions/resolve-sections";

/**
 * A select field's stored value is the referenced row's id, never its
 * label - SchemaForm's Dropdown resolves this via use-field-options.ts,
 * but a plain read-only SchemaTable grid never went through that at all,
 * so every master/non-master-backed select column showed the raw id
 * until a caller hand-wrote its own resolution (this exact bug recurred
 * three times - Purchase's list, Purchase's sub-panels, Companies - before
 * being fixed here once, generically, instead of a fourth one-off patch).
 *
 * Returns Map<master, Map<value, label>> - keyed by the field's
 * optionsSource.master (e.g. "countries", "suppliers"), not by fieldKey,
 * since two fields can share one master and should share one fetch.
 */
export function useMasterLabels(schema: FieldDefinitionsResponse | undefined): Map<string, Map<string, string>> {
  const masters = new Set<string>();
  if (schema) {
    for (const section of resolveFieldSections(schema)) {
      for (const field of section.fields) {
        if (field.dataType === "select" && field.optionsSource?.type === "master" && field.optionsSource.master) {
          masters.add(field.optionsSource.master);
        }
      }
    }
  }
  const masterKeys = [...masters];

  const results = useQueries({
    queries: masterKeys.map((master) => ({
      queryKey: ["field-options", master],
      queryFn: () => apiFetch(resolveOptionsEndpoint(master), {}, { schema: masterOptionsResponseSchema }),
      staleTime: 5 * 60_000,
    })),
  });

  const labelsByMaster = new Map<string, Map<string, string>>();
  masterKeys.forEach((master, index) => {
    const options = results[index]?.data?.options ?? [];
    labelsByMaster.set(master, new Map(options.map((option) => [option.value, option.label])));
  });
  return labelsByMaster;
}
