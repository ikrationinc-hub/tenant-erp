import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";

/** Shared across SalesDetailScreen/SalesFulfilmentPanels/SalesReceivablesPanels - a select field backed by a masters:X optionsSource stores the master's row id, not a label, so every screen that displays one needs this same id->label resolution. Extracted here rather than duplicated a third time (mirrors PurchaseDetailScreen's own useMasterLabels, which Purchase's own fulfilment panels never needed since they don't show an Item column resolved to a name). */
export function useMasterLabels(master: string): Map<string, string> {
  const query = useQuery({
    queryKey: ["field-options", master],
    queryFn: () => apiFetch(endpoints.masterOptions(master), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  const options = query.data?.options ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- options is a fresh array every render; re-keying on it would rebuild the Map every render for no reason.
  return useMemo(() => new Map(options.map((option) => [option.value, option.label])), [query.data]);
}

export function resolvedLabel(labels: Map<string, string>, value: unknown): string {
  const id = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return labels.get(id) ?? id;
}
