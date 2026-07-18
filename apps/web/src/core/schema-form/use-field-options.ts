import { useQuery } from "@tanstack/react-query";
import { useWatch, type Control } from "react-hook-form";
import { masterOptionsResponseSchema, type FieldDefinition, type MasterOption } from "@hyperion/contracts";
import { apiFetch } from "../api/client";
import { endpoints, withQuery } from "../api/endpoints";

const NO_DEPENDENCY = "__schema_form_no_dependency__";

export interface FieldOptionsResult {
  options: MasterOption[];
  isLoading: boolean;
  /** Current value of the field this one cascades from - undefined if it doesn't cascade. */
  parentValue: string | undefined;
  /** True when there's no parent dependency, or the parent already has a value. */
  parentReady: boolean;
}

/**
 * Resolves a Dropdown/Lookup field's options from its options_source
 * (frontend rule 6): static/enum options render as given; a master source
 * fetches from the (forward-looking, see master-options.ts) masters
 * endpoint, cached by TanStack Query and re-keyed on the cascading parent's
 * value and any search term.
 */
export function useFieldOptions(
  field: FieldDefinition,
  control: Control<Record<string, unknown>>,
  searchTerm?: string,
): FieldOptionsResult {
  const source = field.optionsSource;
  const dependsOnField = source?.dependsOn;

  const watchedParent = useWatch({ control, name: dependsOnField ?? NO_DEPENDENCY });
  const parentValue = dependsOnField && typeof watchedParent === "string" ? watchedParent : "";
  const parentReady = !dependsOnField || parentValue.length > 0;

  const masterKey = source?.type === "master" ? (source.master ?? "") : "";
  const isMasterSource = masterKey.length > 0;

  const query = useQuery({
    queryKey: ["field-options", masterKey, parentValue, searchTerm ?? ""],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.masterOptions(masterKey), {
          parentValue: parentValue || undefined,
          search: searchTerm || undefined,
        }),
        {},
        { schema: masterOptionsResponseSchema },
      ),
    enabled: isMasterSource && parentReady,
    staleTime: 5 * 60_000,
  });

  const staticOptions = source?.staticOptions ?? [];

  return {
    options: isMasterSource ? (query.data?.options ?? []) : staticOptions,
    isLoading: isMasterSource ? query.isLoading : false,
    parentValue: dependsOnField ? parentValue : undefined,
    parentReady,
  };
}
