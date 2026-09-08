import type { ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Button, Card, Drawer, Popconfirm, Select, Space, Spin, Table, Tooltip, Typography } from "antd";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { NumericStringInput } from "../../core/schema-form/field-types/NumericStringInput";
import { isPartialNumericString, NUMERIC_STRING_PATTERN } from "../../core/schema-form/numeric-string";
import { Can } from "../../core/permissions/Can";
import { useHasPermission } from "../../core/permissions/use-permissions";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { SALES_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { SALES_LIST_PATH } from "./SalesListScreen";
import { SalesFulfilmentActions, SalesFulfilmentDrawer } from "./SalesFulfilmentPanels";
import { SalesInvoiceAction, SalesInvoiceDrawer } from "./SalesReceivablesPanels";

/** Same pattern as PurchaseDetailScreen's useMasterLabels - a select field backed by a masters:X optionsSource stores the master's row id, not a label. */
function useMasterLabels(master: string): Map<string, string> {
  const query = useQuery({
    queryKey: ["field-options", master],
    queryFn: () => apiFetch(endpoints.masterOptions(master), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  const options = query.data?.options ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- options is a fresh array every render; re-keying on it would rebuild the Map every render for no reason.
  return useMemo(() => new Map(options.map((option) => [option.value, option.label])), [query.data]);
}

function resolvedLabel(labels: Map<string, string>, value: unknown): string {
  const id = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return labels.get(id) ?? id;
}

const SHIPMENT_KEYS = new Set([
  "lotNumber",
  "containerId",
  "blNo",
  "loadingDate",
  "transportModeId",
  "vesselId",
  "voyageNumber",
  "portOfLoadingId",
  "portOfDischargeId",
  "warehouseId",
  "incotermId",
]);

/** createSalesSchema/updateSalesSchema are both `.strict()` - salesNumber/status are system-controlled. Mirrors PurchaseDetailScreen's splitHeaderPayload. */
function splitHeaderPayload(values: Record<string, unknown>): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  const shipment: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "salesNumber") {
      continue;
    }
    if (SHIPMENT_KEYS.has(key)) {
      shipment[key] = value;
    } else {
      header[key] = value;
    }
  }
  return { ...header, shipment };
}

interface SalesAggregate {
  id: string;
  status: "draft" | "approved" | "closed" | "cancelled";
  [key: string]: unknown;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** decimal.js would be overkill for a plain subtraction/min of already-server-computed decimal strings with the same scale - display-only outstanding qty, re-enforced server-side regardless (sales-item-lots.service.ts's own "qty > available" guard). Never used for anything that posts a value on its own. Mirrors SalesFulfilmentPanels.tsx's own subtractDecimalStrings exactly. */
function subtractDecimalStrings(a: string, b: string): string {
  const result = Number(a || "0") - Number(b || "0");
  return (Number.isFinite(result) ? Math.max(result, 0) : 0).toString();
}

function minDecimalStrings(a: string, b: string): string {
  const left = Number(a || "0");
  const right = Number(b || "0");
  if (!Number.isFinite(left)) return b;
  if (!Number.isFinite(right)) return a;
  return (left < right ? left : right).toString();
}

function pricingField(pricing: unknown, key: string): unknown {
  if (typeof pricing !== "object" || pricing === null || !(key in pricing)) {
    return undefined;
  }
  return (pricing as Record<string, unknown>)[key];
}

/**
 * S-3 (docs/SALES-MODULE-PLAN.md). Header+Shipment is one SchemaForm
 * submitted as a nested payload, mirroring PurchaseDetailScreen exactly.
 * Items + their lot picks are their own sub-panel (FR-104: items are added,
 * not declared upfront); Costs is a single upsert form. Approve/Cancel are
 * the only two lifecycle actions this phase has - "Closed" doesn't exist
 * yet (no S-4/S-5 to derive it from), so there is no fulfilment strip here
 * at all, unlike PurchaseDetailScreen's.
 */
export function SalesDetailScreen({
  mode,
  salesId,
}: {
  mode: "create" | "edit";
  salesId?: string;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, notification } = AntApp.useApp();
  const canCreate = useHasPermission("sales.order.create");
  const canUpdate = useHasPermission("sales.order.update");
  const canEditHeader = mode === "create" ? canCreate : canUpdate;
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const salesQuery = useQuery({
    queryKey: ["sales", salesId],
    queryFn: () => apiFetch<SalesAggregate>(`${endpoints.sales}/${salesId}`),
    enabled: mode === "edit" && Boolean(salesId),
  });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["sales", salesId] });
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.sales] });
  }

  async function handleHeaderSubmit(values: Record<string, unknown>): Promise<void> {
    const payload = splitHeaderPayload(values);
    if (mode === "create") {
      const created = await apiFetch<{ id: string }>(endpoints.sales, { method: "POST", body: payload });
      void message.success("Sales order created");
      void navigate(`${SALES_LIST_PATH}/${created.id}`, { replace: true });
      return;
    }
    await apiFetch(`${endpoints.sales}/${salesId}`, { method: "PATCH", body: payload });
    void message.success("Sales order updated");
    refresh();
  }

  async function handleApprove(): Promise<void> {
    const result = await apiFetch<{ warnings?: string[] }>(endpoints.approveSalesOrder(salesId ?? ""), { method: "PATCH" });
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        notification.warning({ message: "Credit limit warning", description: warning, duration: 0 });
      }
    } else {
      void message.success("Sales order approved - lots reserved");
    }
    refresh();
  }

  async function handleCancel(): Promise<void> {
    await apiFetch(endpoints.cancelSalesOrder(salesId ?? ""), { method: "PATCH" });
    void message.success("Sales order cancelled");
    refresh();
  }

  if (mode === "edit" && salesQuery.isLoading) {
    return <Spin />;
  }
  if (mode === "edit" && (salesQuery.isError || !salesQuery.data)) {
    return <Alert type="error" showIcon message="Could not load this sales order" />;
  }

  const salesOrder = salesQuery.data;
  const status = salesOrder?.status;
  const closed = status === "closed";
  const cancelled = status === "cancelled";
  const terminal = closed || cancelled;
  const approved = status === "approved";
  const draft = status === "draft";
  const itemRows = rowsOf(salesOrder?.items);
  // Mirrors sales.service.ts's own approve() guard (validateSalesItemForApproval):
  // every item must have at least one lot picked, not just exist - an
  // unpicked item silently reserves nothing on approve, which used to
  // succeed and leave the sale "approved" with zero real holds.
  const hasItems = itemRows.length > 0 && itemRows.every((item) => rowsOf(item.lots).length > 0);
  // Mirrors sales.service.ts's own cancel() guard (requireNothingFulfilledForCancel):
  // once a delivery or invoice exists against this sale, cancelling would
  // orphan a real document against a dead parent - the button disables
  // the moment either exists, matching the backend's own hasAnyDelivery/
  // hasAnyInvoice check exactly (any document at all, regardless of its
  // own status).
  const hasAnyDelivery = asDisplayString(salesOrder?.deliveredStatus) !== "not_delivered" && Boolean(salesOrder?.deliveredStatus);
  const hasAnyInvoice = asDisplayString(salesOrder?.invoicedStatus) !== "not_invoiced" && Boolean(salesOrder?.invoicedStatus);
  const cancelBlockedReason = hasAnyDelivery
    ? "This sale already has a delivery against it - it can no longer be cancelled."
    : hasAnyInvoice
      ? "This sale already has an invoice against it - it can no longer be cancelled."
      : undefined;
  const headerInitialValues =
    salesOrder && typeof salesOrder.shipment === "object" && salesOrder.shipment !== null
      ? { ...salesOrder, ...(salesOrder.shipment as Record<string, unknown>) }
      : salesOrder;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {mode === "create" ? "New Sale" : `Sales Order ${asDisplayString(salesOrder?.salesNumber)}`}
          </Typography.Title>
          {status && <StatusTag value={status} colorMap={SALES_STATUS_COLORS} />}
        </Space>
        {mode === "edit" && salesId && (
          <Space>
            {approved && (
              <SalesFulfilmentActions
                approved={approved}
                deliveredStatus={asDisplayString(salesOrder?.deliveredStatus)}
                onDeliver={() => setDeliverOpen(true)}
              />
            )}
            {approved && <SalesInvoiceAction approved={approved} onInvoice={() => setInvoiceOpen(true)} />}
            {draft && (
              <Can permission="sales.order.approve">
                <Tooltip title={hasItems ? undefined : "Add at least one item and pick its lots before approving"}>
                  <Popconfirm
                    title="Approve this sales order?"
                    description="This reserves the picked stock lots - they'll be held for this sale until it's delivered or cancelled."
                    okText="Approve"
                    cancelText="Back"
                    disabled={!hasItems}
                    onConfirm={() => void handleApprove()}
                  >
                    <Button type="primary" disabled={!hasItems}>
                      Approve
                    </Button>
                  </Popconfirm>
                </Tooltip>
              </Can>
            )}
            {(draft || approved) && (
              <Can permission="sales.order.cancel">
                <Tooltip title={cancelBlockedReason}>
                  <Popconfirm
                    title="Cancel this sales order?"
                    description={approved ? "Any reserved lots will be released back to available stock." : undefined}
                    okText="Cancel Sale"
                    cancelText="Back"
                    disabled={Boolean(cancelBlockedReason)}
                    onConfirm={() => void handleCancel()}
                  >
                    <Button danger disabled={Boolean(cancelBlockedReason)}>
                      Cancel
                    </Button>
                  </Popconfirm>
                </Tooltip>
              </Can>
            )}
          </Space>
        )}
      </Space>

      {approved && (
        <Alert
          type="info"
          showIcon
          message="This sales order is approved. Its picked lots are reserved. Header and costs are now locked. Items stay editable until the sale closes or is cancelled."
          description={
            salesOrder?.deliveredStatus
              ? `Delivery status: ${asDisplayString(salesOrder.deliveredStatus).replace(/_/g, " ")} · Invoiced: ${asDisplayString(salesOrder.invoicedStatus).replace(/_/g, " ")} · Paid: ${asDisplayString(salesOrder.paidStatus).replace(/_/g, " ")}`
              : undefined
          }
        />
      )}
      {closed && <Alert type="success" showIcon message="This sales order is closed. It is now immutable; corrections require a reversal and re-entry." />}
      {cancelled && <Alert type="warning" showIcon message="This sales order was cancelled. Any reservations it held have been released. It is now immutable." />}

      <SchemaForm
        module="sales"
        entity="header"
        mode={(mode === "edit" && !draft) || !canEditHeader ? "view" : mode === "create" ? "create" : "edit"}
        {...(headerInitialValues ? { initialValues: headerInitialValues } : {})}
        onSubmit={handleHeaderSubmit}
        onDiscard={() => void navigate(SALES_LIST_PATH)}
      />

      {mode === "edit" && salesId && salesOrder && (
        <>
          <SalesCostsPanel salesId={salesId} readOnly={!draft || !canUpdate} onSaved={refresh} costs={salesOrder.additionalCosts} />
          <SalesItemsPanel salesId={salesId} readOnly={terminal} onAdded={refresh} items={rowsOf(salesOrder.items)} />
          <SalesFulfilmentDrawer
            open={deliverOpen}
            salesId={salesId}
            items={rowsOf(salesOrder.items).map((item) => ({
              id: asDisplayString(item.id),
              quantity: asDisplayString(item.quantity) || "0",
              reservedQty: asDisplayString(item.reservedQty) || "0",
              consumedQty: asDisplayString(item.consumedQty) || "0",
            }))}
            onClose={() => setDeliverOpen(false)}
            onDone={() => {
              setDeliverOpen(false);
              refresh();
            }}
          />
          <SalesInvoiceDrawer
            open={invoiceOpen}
            salesId={salesId}
            items={rowsOf(salesOrder.items).map((item) => ({
              id: asDisplayString(item.id),
              deliveredQty: asDisplayString(item.deliveredQty) || "0",
              invoicedQty: asDisplayString(item.invoicedQty) || "0",
            }))}
            onClose={() => setInvoiceOpen(false)}
            onDone={() => {
              setInvoiceOpen(false);
              refresh();
            }}
          />
        </>
      )}
    </Space>
  );
}

function SalesCostsPanel({
  salesId,
  readOnly,
  onSaved,
  costs,
}: {
  salesId: string;
  readOnly: boolean;
  onSaved: () => void;
  costs: unknown;
}): ReactElement {
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.salesCosts(salesId), { method: "PATCH", body: values });
    void message.success("Additional costs saved");
    onSaved();
  }

  return (
    <Card title="Additional Cost" size="small">
      <SchemaForm
        module="sales"
        entity="costs"
        mode={readOnly ? "view" : "edit"}
        initialValues={typeof costs === "object" && costs !== null ? (costs as Record<string, unknown>) : {}}
        onSubmit={handleSubmit}
      />
    </Card>
  );
}

function SalesItemsPanel({
  salesId,
  readOnly,
  onAdded,
  items,
}: {
  salesId: string;
  readOnly: boolean;
  onAdded: () => void;
  items: Record<string, unknown>[];
}): ReactElement {
  const [addOpen, setAddOpen] = useState(false);
  // Tracks only the id, not a snapshot of the row itself - onAdded()
  // invalidates and refetches the parent sales query, producing a NEW
  // `items` array each time, but a `useState<Row>` capture taken at click
  // time would never see that refetch (a plain snapshot, not a
  // subscription). Re-deriving the current row from the live `items` prop
  // on every render is what makes "Add Pick"/"Remove" reflect immediately
  // without closing and reopening the drawer.
  const [lotsDrawerItemId, setLotsDrawerItemId] = useState<string | null>(null);
  const lotsDrawerItem = lotsDrawerItemId ? (items.find((row) => asDisplayString(row.id) === lotsDrawerItemId) ?? null) : null;
  const { message } = AntApp.useApp();
  const itemLabels = useMasterLabels("items");
  const gradeLabels = useMasterLabels("item-grades");
  const uomLabels = useMasterLabels("uom");

  async function handleAddItem(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.salesItems(salesId), { method: "POST", body: values });
    void message.success("Item added");
    setAddOpen(false);
    onAdded();
  }

  return (
    <Card
      title="Sales Items & Pricing"
      size="small"
      extra={
        !readOnly && (
          <Can permission="sales.order.create">
            <Button onClick={() => setAddOpen(true)}>Add Item</Button>
          </Can>
        )
      }
    >
      <Table
        dataSource={items}
        rowKey="id"
        pagination={false}
        size="small"
        locale={{ emptyText: "No items yet" }}
        columns={[
          { title: "Item", dataIndex: "itemId", render: (value) => resolvedLabel(itemLabels, value) },
          { title: "Grade", dataIndex: "gradeId", render: (value) => resolvedLabel(gradeLabels, value) },
          { title: "Quantity", dataIndex: "quantity" },
          { title: "UOM", dataIndex: "uomId", render: (value) => resolvedLabel(uomLabels, value) },
          {
            title: "Rate (USD)",
            dataIndex: "pricing",
            render: (pricing: unknown) => asDisplayString(pricingField(pricing, "salesRateUsd")),
          },
          {
            title: "Amount (USD)",
            dataIndex: "pricing",
            render: (pricing: unknown) => asDisplayString(pricingField(pricing, "salesAmountUsd")),
          },
          {
            title: "Amount (AED)",
            dataIndex: "pricing",
            render: (pricing: unknown) => asDisplayString(pricingField(pricing, "salesAmountAed")),
          },
          {
            title: "Lots",
            key: "lots",
            render: (_value, row): ReactNode => {
              const lots = rowsOf(row.lots);
              return (
                <Space>
                  <Typography.Text type="secondary">{lots.length} picked</Typography.Text>
                  <Button size="small" onClick={() => setLotsDrawerItemId(asDisplayString(row.id))}>
                    {readOnly ? "View Lots" : "Manage Lots"}
                  </Button>
                </Space>
              );
            },
          },
        ]}
      />
      <Drawer title="Add Sales Item" open={addOpen} onClose={() => setAddOpen(false)} width={420} destroyOnHidden>
        <SchemaForm module="sales" entity="item" mode="create" onSubmit={handleAddItem} />
      </Drawer>
      {lotsDrawerItem && (
        <SalesItemLotsDrawer
          salesId={salesId}
          item={lotsDrawerItem}
          readOnly={readOnly}
          onClose={() => setLotsDrawerItemId(null)}
          onChanged={onAdded}
        />
      )}
    </Card>
  );
}

interface StockLotOption {
  id: string;
  itemId: string;
  gradeId: string | null;
  warehouseId: string;
  /** Server-computed (receivedQty - reservedQty - deliveredQty) - never recomputed here, frontend rule 3. */
  availableQty: string;
  landedRate: string;
}

/**
 * FR-104's lot-picker - S-3's genuinely new UI, no existing panel to mirror
 * (PurchaseAllocations is a different, unrelated concept - see database/
 * tenant/schema.ts's own doc comment on sales_item_lots). Shows every
 * currently-picked lot for this item plus a form to pick another,
 * restricted to lots matching the item's own itemId/gradeId. Available
 * qty shown here is a live, UNLOCKED read (sales-item-lots.repository.ts's
 * own doc comment) - the real lock only happens at Approve.
 */
function SalesItemLotsDrawer({
  salesId,
  item,
  readOnly,
  onClose,
  onChanged,
}: {
  salesId: string;
  item: Record<string, unknown>;
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const itemId = asDisplayString(item.id);
  const itemItemId = asDisplayString(item.itemId);
  const itemGradeId = typeof item.gradeId === "string" ? item.gradeId : null;
  const lots = rowsOf(item.lots);
  const warehouseLabels = useMasterLabels("warehouses");

  const availableLotsQuery = useQuery({
    queryKey: ["stock-lots-available", itemItemId, itemGradeId, itemId],
    queryFn: () =>
      apiFetch<{ options: StockLotOption[] }>(
        withQuery(endpoints.availableStockLots, { itemId: itemItemId, salesItemId: itemId, ...(itemGradeId ? { gradeId: itemGradeId } : {}) }),
      ),
    enabled: !readOnly,
  });

  const [selectedLotId, setSelectedLotId] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState("");

  // Excludes lots with nothing left to pick (the server-side query itself
  // still returns them - it's a live snapshot of stock_lots, not filtered
  // to "still pickable" - so a lot another sale just fully consumed can
  // otherwise sit in this list showing "available 0" and still be
  // selectable). Caught in manual testing: a 0-available lot appeared
  // selectable and its stale-cached "available 2" mismatched the server's
  // real rejection at pick time.
  const availableLots = (availableLotsQuery.data?.options ?? []).filter((lot) => Number(lot.availableQty) > 0);
  const selectedLot = availableLots.find((lot) => lot.id === selectedLotId);
  // The two real ceilings on a pick: this item's own remaining-to-pick
  // quantity (ordered qty minus what's already picked across every lot,
  // not just this one), and the selected lot's own availableQty. Neither
  // alone is the answer - a lot can have more stock than the item still
  // needs, or an item can still need more than one lot has left. Display-
  // only (frontend rule 3's documented exception, mirrors SalesFulfilment
  // Panels.tsx's own OutstandingQtyTable) - sales-item-lots.service.ts's
  // addLot still re-checks the real ceiling server-side regardless.
  const alreadyPickedQty = lots.reduce((sum, lot) => sum + Number(asDisplayString(lot.qty) || "0"), 0).toString();
  const itemRemainingQty = subtractDecimalStrings(asDisplayString(item.quantity), alreadyPickedQty);
  const maxPickQty = selectedLot ? minDecimalStrings(itemRemainingQty, selectedLot.availableQty) : itemRemainingQty;

  async function handlePick(): Promise<void> {
    if (!selectedLotId || !qty) {
      return;
    }
    await apiFetch(endpoints.salesItemLots(salesId, itemId), { method: "POST", body: { stockLotId: selectedLotId, qty } });
    void message.success("Lot picked");
    setSelectedLotId(undefined);
    setQty("");
    void queryClient.invalidateQueries({ queryKey: ["stock-lots-available", itemItemId, itemGradeId, itemId] });
    onChanged();
  }

  async function handleRemove(lotPickId: string): Promise<void> {
    await apiFetch(endpoints.salesItemLot(salesId, itemId, lotPickId), { method: "DELETE" });
    void message.success("Lot pick removed");
    void queryClient.invalidateQueries({ queryKey: ["stock-lots-available", itemItemId, itemGradeId, itemId] });
    onChanged();
  }

  return (
    <Drawer title="Manage Lot Picks" open onClose={onClose} width={480} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Table
          dataSource={lots}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: "No lots picked yet" }}
          columns={[
            {
              title: "Lot",
              dataIndex: "stockLotId",
              render: (value: unknown) => {
                const stockLotId = asDisplayString(value);
                const matchingLot = availableLots.find((lot) => lot.id === stockLotId);
                // Falls back to a short id when the lot no longer appears
                // in the "available" set (e.g. fully consumed elsewhere) -
                // that endpoint only ever returns lots with real capacity
                // left, so a fully-picked lot legitimately can't resolve
                // a friendly name through it.
                return matchingLot ? resolvedLabel(warehouseLabels, matchingLot.warehouseId) : stockLotId.slice(0, 8);
              },
            },
            { title: "Qty", dataIndex: "qty" },
            {
              title: "Reserved",
              dataIndex: "reservationId",
              render: (value: unknown) => (value ? <Typography.Text type="success">Yes</Typography.Text> : <Typography.Text type="secondary">Not yet</Typography.Text>),
            },
            ...(readOnly
              ? []
              : [
                  {
                    title: "",
                    key: "actions",
                    render: (_value: unknown, row: Record<string, unknown>): ReactNode =>
                      row.reservationId ? null : (
                        <Button size="small" danger onClick={() => void handleRemove(String(row.id))}>
                          Remove
                        </Button>
                      ),
                  },
                ]),
          ]}
        />
        {!readOnly && (
          <Card size="small" title="Pick another lot">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                style={{ width: "100%" }}
                placeholder="Select a lot..."
                aria-label="Stock lot"
                value={selectedLotId ?? null}
                onChange={(value: string) => setSelectedLotId(value || undefined)}
                options={availableLots.map((lot) => ({
                  value: lot.id,
                  label: `${resolvedLabel(warehouseLabels, lot.warehouseId)} - available ${lot.availableQty} - landed rate ${lot.landedRate}`,
                }))}
              />
              <NumericStringInput
                id="lot-pick-qty"
                ariaLabel="Lot pick quantity"
                placeholder="Quantity"
                value={qty}
                onChange={(next) => {
                  if (next === "" || isPartialNumericString(next)) {
                    setQty(next);
                  }
                }}
                onBlur={() => {
                  if (qty !== "" && NUMERIC_STRING_PATTERN.test(qty) && Number(qty) > Number(maxPickQty)) {
                    setQty(maxPickQty);
                  }
                }}
              />
              {selectedLotId && (
                <Typography.Text type="secondary">
                  Max: {maxPickQty} (item needs {itemRemainingQty} more, this lot has {selectedLot?.availableQty ?? "0"} available)
                </Typography.Text>
              )}
              <Button type="primary" disabled={!selectedLotId || !qty} onClick={() => void handlePick()}>
                Add Pick
              </Button>
            </Space>
          </Card>
        )}
      </Space>
    </Drawer>
  );
}
