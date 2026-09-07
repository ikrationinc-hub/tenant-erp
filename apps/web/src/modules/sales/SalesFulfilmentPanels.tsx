import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Select, Space, Spin, Table, Typography } from "antd";
import { paginatedRowsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { NumericStringInput } from "../../core/schema-form/field-types/NumericStringInput";
import { isPartialNumericString, NUMERIC_STRING_PATTERN } from "../../core/schema-form/numeric-string";
import { useDebouncedValue } from "../../core/schema-form/use-debounced-value";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

interface FulfilmentItemRow {
  id: string;
  quantity: string;
  reservedQty: string;
  consumedQty: string;
}

/** decimal.js would be overkill for a plain subtraction of two already-server-computed decimal strings with the same scale - this is display-only outstanding qty, recomputed server-side for real at delivery-confirm time regardless (deliveries.service.ts's own over-delivery guard). Never used for anything that posts a value on its own. Mirrors PurchaseFulfilmentPanels.tsx's own subtractDecimalStrings exactly. */
function subtractDecimalStrings(a: string, b: string): string {
  const result = Number(a || "0") - Number(b || "0");
  return (Number.isFinite(result) ? Math.max(result, 0) : 0).toString();
}

interface OutstandingQtyTableProps {
  items: FulfilmentItemRow[];
  quantities: Record<string, string>;
  onChange: (itemId: string, value: string) => void;
}

/**
 * S-4 (docs/SALES-MODULE-PLAN.md): mirrors PurchaseFulfilmentPanels.tsx's
 * own OutstandingQtyTable exactly, capped at reserved-minus-consumed (not
 * ordered-minus-received like Purchase's own axis) - a sales item can only
 * ever deliver what got reserved at Approve time (sales-lifecycle.ts's own
 * doc comment). Hand-built, not SchemaForm - same reasoning as Purchase's.
 */
function OutstandingQtyTable({ items, quantities, onChange }: OutstandingQtyTableProps): ReactElement {
  return (
    <Table
      dataSource={items}
      rowKey="id"
      pagination={false}
      size="small"
      columns={[
        { title: "Item", dataIndex: "id", render: (value: string) => value.slice(0, 8) },
        { title: "Reserved", dataIndex: "reservedQty" },
        { title: "Already Delivered", dataIndex: "consumedQty" },
        {
          title: "Outstanding",
          key: "outstanding",
          render: (_value, row: FulfilmentItemRow) => subtractDecimalStrings(row.reservedQty, row.consumedQty),
        },
        {
          title: "Deliver Qty",
          key: "input",
          render: (_value, row: FulfilmentItemRow) => {
            const outstanding = subtractDecimalStrings(row.reservedQty, row.consumedQty);
            const value = quantities[row.id] ?? "";
            const overCap = value !== "" && NUMERIC_STRING_PATTERN.test(value) && Number(value) > Number(outstanding);
            return (
              <NumericStringInput
                id={`qty-${row.id}`}
                ariaLabel={`Quantity for item ${row.id}`}
                value={value}
                onChange={(next) => {
                  if (next === "" || isPartialNumericString(next)) {
                    onChange(row.id, next);
                  }
                }}
                onBlur={() => {
                  if (overCap) {
                    onChange(row.id, outstanding);
                  }
                }}
              />
            );
          },
        },
      ]}
    />
  );
}

/**
 * S-4: opens from the Sales Order's "Deliver" action, prefilled with every
 * item's outstanding (reserved - already delivered) quantity, editable
 * down for a partial delivery. Confirming is a single POST (create the
 * delivery as draft) followed immediately by PATCH .../confirm - same
 * one-action reasoning as PurchaseReceiptForm (no "save as draft, confirm
 * later" UI step). `items` here is the Sales Order's own items array
 * (each carrying `reservedQty`/`consumedQty` computed server-side, see
 * deliveries.repository.ts's sumReservedAndConsumedBySalesItem) - NOT the
 * ordered quantity Purchase's own form reads.
 */
export function SalesDeliveryForm({
  salesId,
  items,
  onDone,
  onClose,
}: {
  salesId: string;
  items: FulfilmentItemRow[];
  onDone: () => void;
  onClose: () => void;
}): ReactElement {
  const { message } = AntApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const fulfilmentItems = useMemo(() => items.filter((item) => Number(item.reservedQty) > Number(item.consumedQty)), [items]);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(fulfilmentItems.map((item) => [item.id, subtractDecimalStrings(item.reservedQty, item.consumedQty)])),
  );

  async function handleSubmit(headerValues: Record<string, unknown>): Promise<void> {
    const lines = fulfilmentItems
      .map((item) => ({ salesItemId: item.id, deliveredQuantity: quantities[item.id] ?? "" }))
      .filter((line) => line.deliveredQuantity !== "" && NUMERIC_STRING_PATTERN.test(line.deliveredQuantity) && Number(line.deliveredQuantity) > 0);

    if (lines.length === 0) {
      void message.error("Enter a quantity for at least one item");
      return;
    }

    setSubmitting(true);
    try {
      const delivery = await apiFetch<{ id: string }>(endpoints.salesDeliveries(salesId), {
        method: "POST",
        body: { ...headerValues, items: lines },
      });
      await apiFetch(endpoints.confirmSalesDelivery(salesId, delivery.id), { method: "PATCH" });
      void message.success("Delivery confirmed - stock updated");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  if (fulfilmentItems.length === 0) {
    return <Typography.Text type="secondary">Every reserved item on this sale has already been fully delivered.</Typography.Text>;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <OutstandingQtyTable items={fulfilmentItems} quantities={quantities} onChange={(id, value) => setQuantities((prev) => ({ ...prev, [id]: value }))} />
      <SchemaForm
        module="sales"
        entity="delivery"
        mode="create"
        hiddenFields={["deliveryOrderNo"]}
        onSubmit={handleSubmit}
        onDiscard={onClose}
        footer={submitting ? <Typography.Text type="secondary">Confirming delivery…</Typography.Text> : undefined}
      />
    </Space>
  );
}

/** Wraps SalesDeliveryForm in its own Drawer, driven by the Sales Order detail screen's Deliver action - mirrors PurchaseFulfilmentDrawer. */
export function SalesFulfilmentDrawer({
  open,
  salesId,
  items,
  onClose,
  onDone,
}: {
  open: boolean;
  salesId: string;
  items: FulfilmentItemRow[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  return (
    <Drawer title="Deliver Items" open={open} onClose={onClose} width={560} destroyOnHidden>
      <SalesDeliveryForm salesId={salesId} items={items} onDone={onDone} onClose={onClose} />
    </Drawer>
  );
}

/** The Sales Order detail screen's own Deliver button - permission-gated (<Can/>, frontend rule 4), only shown once Approved (draft has nothing reserved yet) and only while there's something outstanding. Mirrors PurchaseFulfilmentActions. */
export function SalesFulfilmentActions({
  approved,
  deliveredStatus,
  onDeliver,
}: {
  approved: boolean;
  deliveredStatus: string;
  onDeliver: () => void;
}): ReactElement | null {
  if (!approved || deliveredStatus === "fully_delivered") {
    return null;
  }
  return (
    <Can permission="sales.delivery.create">
      <Button onClick={onDeliver}>Deliver</Button>
    </Can>
  );
}

interface SalesOptionRow {
  id: string;
  salesNumber: string;
}

/**
 * S-4 follow-up: Zoho's own "New" button on the standalone Deliveries list
 * screen - a second entry point into the SAME Deliver flow the Sales
 * Order detail screen's own button already drives. Mirrors
 * PurchaseOrderPicker exactly, filtered to approved sales orders with
 * something outstanding (deliveredStatus not_delivered or partial).
 */
function SalesOrderPicker({ value, onChange }: { value: string | undefined; onChange: (salesId: string) => void }): ReactElement {
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const notDeliveredQuery = useQuery({
    queryKey: ["entity-list", endpoints.sales, "fulfilment-picker", debouncedSearch],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.sales, { status: "approved", deliveredStatus: "not_delivered", search: debouncedSearch || undefined, pageSize: "20" }),
        {},
        { schema: paginatedRowsResponseSchema },
      ),
  });

  const partialQuery = useQuery({
    queryKey: ["entity-list", endpoints.sales, "fulfilment-picker-partial", debouncedSearch],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.sales, { status: "approved", deliveredStatus: "partial", search: debouncedSearch || undefined, pageSize: "20" }),
        {},
        { schema: paginatedRowsResponseSchema },
      ),
  });

  const rawRows = [...(notDeliveredQuery.data?.items ?? []), ...(partialQuery.data?.items ?? [])];
  const options = rawRows
    .map((row): SalesOptionRow | undefined => {
      const id = asDisplayString(row.id);
      const salesNumber = asDisplayString(row.salesNumber);
      return id && salesNumber ? { id, salesNumber } : undefined;
    })
    .filter((row): row is SalesOptionRow => row !== undefined)
    .map((row) => ({ value: row.id, label: row.salesNumber }));

  return (
    <Select
      style={{ width: "100%" }}
      placeholder="Select a Sales Order"
      showSearch
      filterOption={false}
      value={value ?? null}
      onSearch={setSearchInput}
      onChange={onChange}
      options={options}
      loading={notDeliveredQuery.isFetching || partialQuery.isFetching}
      notFoundContent={notDeliveredQuery.isFetching || partialQuery.isFetching ? "Searching…" : "No matching sales orders"}
    />
  );
}

interface SalesAggregateForDelivery {
  id: string;
  items?: Record<string, unknown>[];
}

function toFulfilmentItems(items: Record<string, unknown>[]): FulfilmentItemRow[] {
  return items.map((item) => ({
    id: asDisplayString(item.id),
    quantity: asDisplayString(item.quantity) || "0",
    reservedQty: asDisplayString(item.reservedQty) || "0",
    consumedQty: asDisplayString(item.consumedQty) || "0",
  }));
}

function useSalesAggregate(salesId: string | undefined) {
  return useQuery({
    queryKey: ["sales", salesId],
    queryFn: () => apiFetch<SalesAggregateForDelivery>(`${endpoints.sales}/${salesId}`),
    enabled: Boolean(salesId),
  });
}

/** Wraps SalesDeliveryForm behind its own Sales Order picker - the "New" button on SalesDeliveriesListScreen. Mirrors NewPurchaseReceiptDrawer. */
export function NewSalesDeliveryDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): ReactElement {
  const [salesId, setSalesId] = useState<string | undefined>(undefined);
  const salesQuery = useSalesAggregate(salesId);

  function handleClose(): void {
    setSalesId(undefined);
    onClose();
  }

  return (
    <Drawer title="New Delivery" open={open} onClose={handleClose} width={560} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <SalesOrderPicker value={salesId} onChange={setSalesId} />
        {salesId && salesQuery.isLoading && <Spin />}
        {salesId && salesQuery.data && (
          <SalesDeliveryForm
            salesId={salesId}
            items={toFulfilmentItems(salesQuery.data.items ?? [])}
            onDone={() => {
              setSalesId(undefined);
              onDone();
            }}
            onClose={handleClose}
          />
        )}
      </Space>
    </Drawer>
  );
}
