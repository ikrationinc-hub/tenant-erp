import { useQuery } from "@tanstack/react-query";
import { useWatch, type Control } from "react-hook-form";
import { masterOptionsResponseSchema, type FieldDefinition, type MasterOption } from "@ikration/contracts";
import { apiFetch } from "../api/client";
import { endpoints, withQuery } from "../api/endpoints";

const NO_DEPENDENCY = "__schema_form_no_dependency__";

/** None of these are core/masters/registry.ts masters (roles is RBAC, FE-5.5; suppliers/users/branches are their own modules, FE-6) but are options-sourced the same way - routed to their own /options route instead of GET /masters/<key>/options. "customers" used to be here too (before it existed as a real master) - the real field-engine now sends optionsSource "masters:customers" for purchase/allocation's reservedCustomerId, so it resolves through the generic masters branch below instead (verified against the real backend, FE-8). */
const NON_MASTER_OPTIONS_ENDPOINTS: Record<string, string> = {
  roles: `${endpoints.roles}/options`,
  suppliers: endpoints.supplierOptions,
  brokers: endpoints.brokerOptions,
  users: endpoints.userOptions,
  branches: endpoints.branchOptions,
  companies: endpoints.companyOptions,
};

/** Exported for schema-table/use-master-labels.ts - a read-only grid resolving a select column's stored id to its label needs the exact same endpoint routing this Dropdown field uses, not a second hand-maintained copy of NON_MASTER_OPTIONS_ENDPOINTS. */
export function resolveOptionsEndpoint(master: string): string {
  return NON_MASTER_OPTIONS_ENDPOINTS[master] ?? endpoints.masterOptions(master);
}

export interface NonMasterCreateConfig {
  endpoint: string;
  buildPayload: (name: string) => Record<string, unknown>;
}

/** Non-master options sources whose "+ Add" quick-create (LookupField.tsx) needs a different endpoint/payload than the generic POST /masters/<key> + {code,name} - these aren't core/masters/registry.ts entries, they're their own modules (mirrors NON_MASTER_OPTIONS_ENDPOINTS above). Anything absent from this map keeps using the generic masters create path. */
export const NON_MASTER_CREATE_ENDPOINTS: Record<string, NonMasterCreateConfig> = {
  companies: {
    endpoint: endpoints.companies,
    buildPayload: (name) => ({ name, fiscalYearStartMonth: 1, timezone: "UTC" }),
  },
  branches: {
    // Same {code, name} shape the generic masters fallback already sends -
    // branches.validator.ts's createBranchSchema requires both, just at
    // POST /branches instead of the nonexistent /masters/branches.
    endpoint: endpoints.branches,
    buildPayload: (name) => ({ code: name, name }),
  },
  brokers: {
    // createBrokerSchema requires only `name` - unlike containers/branches,
    // sending `code` here would 422 (.strict() rejects unknown fields).
    endpoint: endpoints.brokers,
    buildPayload: (name) => ({ name }),
  },
  roles: {
    // createRoleSchema requires only `name`.
    endpoint: endpoints.roles,
    buildPayload: (name) => ({ name }),
  },
  // users is deliberately NOT here: inviting a user requires email/mobile/
  // roles and actually sends an invitation - it doesn't fit a quick-add of
  // any shape (text box or form modal), quick or otherwise.
};

export interface LookupCreateFormConfig {
  module: string;
  entity: string;
  endpoint: string;
}

/**
 * Non-master sources that need MORE than a name to create - unlike
 * NON_MASTER_CREATE_ENDPOINTS's single-text-box "+ Add", these open the
 * target entity's own real create form (SchemaForm, e.g. the same one
 * /suppliers uses) in a modal (LookupField.tsx's LookupCreateModal), so
 * the required fields are actually collected from the user instead of
 * being guessed/fabricated. A masterKey belongs in exactly one of this
 * map or NON_MASTER_CREATE_ENDPOINTS, never both.
 */
export const LOOKUP_CREATE_FORMS: Record<string, LookupCreateFormConfig> = {
  suppliers: {
    // createSupplierSchema requires supplierTypeId/countryId/paymentTermId/
    // currencyId beyond name - no single default is honest for those.
    module: "suppliers",
    entity: "supplier",
    endpoint: endpoints.suppliers,
  },
};

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
        withQuery(resolveOptionsEndpoint(masterKey), {
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
