import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { masterOptionsResponseSchema, type MasterOption } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";

export const INVENTORY_PATH = "/inventory";
export const INVENTORY_MOVEMENTS_PATH = `${INVENTORY_PATH}/movements`;

/** Same pattern as modules/purchase/PurchaseListScreen.tsx's local useMasterOptions - shared here because both Balances and Movements screens need to resolve the same item/grade/warehouse/uom ids to labels. */
export function useMasterOptions(endpoint: string): MasterOption[] {
  const query = useQuery({
    queryKey: ["field-options", endpoint],
    queryFn: () => apiFetch(endpoint, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

export function useLabelMap(options: MasterOption[]): Map<string, string> {
  return useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
}

export function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function resolvedLabel(labels: Map<string, string>, value: unknown): string {
  const id = asDisplayString(value);
  if (!id) {
    return "—";
  }
  return labels.get(id) ?? id;
}
