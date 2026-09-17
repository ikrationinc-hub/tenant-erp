import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Drawer, Input, Popconfirm, Select, Space, Spin, Steps, Table, Tag, Typography } from "antd";
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
  receivedQuantity: string;
  billedQuantity: string;
  /** docs/PO-SHORT-CLOSE.md: the written-off remainder - lowers the billable ceiling below plain (quantity - billedQuantity) once set, same as the server's own guard (purchase-bills.service.ts). "0" for a line that's never been short-closed. */
  shortClosedQty: string;
  /** The item's own server-computed purchase amount (pricing.purchaseAmountUsd, a string) - the Bill form's per-line "Bill Amount (USD)" defaults to this verbatim (a pass-through, never a frontend calculation - rule 3) and is editable down for a partial bill. Unused by the Receipt form. */
  purchaseAmountUsd: string;
}

function pricingField(pricing: unknown, key: string): unknown {
  if (typeof pricing !== "object" || pricing === null || !(key in pricing)) {
    return undefined;
  }
  return (pricing as Record<string, unknown>)[key];
}

function toFulfilmentItems(items: Record<string, unknown>[]): FulfilmentItemRow[] {
  return items.map((item) => ({
    id: asDisplayString(item.id),
    quantity: asDisplayString(item.quantity) || "0",
    receivedQuantity: asDisplayString(item.receivedQuantity) || "0",
    billedQuantity: asDisplayString(item.billedQuantity) || "0",
    shortClosedQty: asDisplayString(item.shortClosedQty) || "0",
    purchaseAmountUsd: asDisplayString(pricingField(item.pricing, "purchaseAmountUsd")) || "0",
  }));
}

/** decimal.js would be overkill for a plain subtraction of two already-server-computed decimal strings with the same scale - this is display-only outstanding qty, recomputed server-side for real at receive/bill time regardless (purchase-receipts.service.ts's own over-receipt guard). Never used for anything that posts a value on its own. */
function subtractDecimalStrings(a: string, b: string): string {
  const result = Number(a || "0") - Number(b || "0");
  return (Number.isFinite(result) ? Math.max(result, 0) : 0).toString();
}

/**
 * docs/PO-SHORT-CLOSE.md, user-confirmed: the Bill form's billable ceiling
 * for one line - min(ordered - shortClosed, received) once ANY receipt
 * exists or the line is short-closed, but plain ordered qty for a line
 * with zero receipts and no short-close (the pre-shipment/LC invoice flow
 * PURCHASE-LIFECYCLE-4DOC.md §1 already supports - nothing changes there).
 * Mirrors purchase-bills.service.ts's own create() guard exactly - display
 * only, the server re-checks this for real regardless.
 */
function billableCeiling(row: FulfilmentItemRow): string {
  const ordered = Number(row.quantity || "0");
  const received = Number(row.receivedQuantity || "0");
  const shortClosed = Number(row.shortClosedQty || "0");
  if (received <= 0 && shortClosed <= 0) {
    return row.quantity;
  }
  const orderedLessShortClosed = ordered - shortClosed;
  return String(Math.max(Math.min(orderedLessShortClosed, received), 0));
}

/**
 * docs/PO-SHORT-CLOSE.md: mirrors purchase-receipts.service.ts's own
 * over-receipt guard - a short-closed line's written-off remainder lowers
 * what's still receivable, same as it lowers what's still billable. A line
 * with no short-close at all keeps its plain ordered qty as the ceiling,
 * unchanged.
 */
function receivableCeiling(row: FulfilmentItemRow): string {
  const ordered = Number(row.quantity || "0");
  const shortClosed = Number(row.shortClosedQty || "0");
  return String(Math.max(ordered - shortClosed, 0));
}

/** The "ceiling" a line can be receipted/billed up to, before subtracting what's already been received/billed - receivableCeiling for the Receipt form, the received-qty-aware billableCeiling for the Bill form. Both collapse to plain ordered qty for a line that's never been short-closed. */
function fulfilmentCeiling(row: FulfilmentItemRow, axis: "received" | "billed"): string {
  return axis === "received" ? receivableCeiling(row) : billableCeiling(row);
}

/**
 * PL-4/PL-5: Zoho's own Order -> Receive -> Bill -> Pay status block, now
 * fully real - Pay reflects the PO's own derived paidStatus (not_paid/
 * partial/fully_paid, purchase.service.ts's computePaidStatus, summed
 * across every bill's own payment allocations) instead of the PL-4-era
 * hardcoded "Coming soon" placeholder.
 */
export function PurchaseFulfilmentStrip({
  status,
  receivedStatus,
  billedStatus,
  paidStatus,
}: {
  status: string;
  receivedStatus: string;
  billedStatus: string;
  paidStatus: string;
}): ReactElement {
  const orderStatus = status === "cancelled" ? "error" : status === "draft" ? "wait" : "finish";
  // docs/PO-SHORT-CLOSE.md: "short_closed" (PO-level) means nothing is
  // genuinely still pending - render it "finish" like fully_received, but
  // with its own distinct label so it never reads as "everything actually
  // arrived" when it didn't.
  const receiveStatus =
    receivedStatus === "fully_received" || receivedStatus === "short_closed"
      ? "finish"
      : receivedStatus === "partial"
        ? "process"
        : "wait";
  // docs/PO-SHORT-CLOSE.md: the billed axis has no "short_closed" state of
  // its own (see purchase-lifecycle.ts's computeBilledStatus doc comment)
  // - a short-closed line's billable ceiling is still real and non-zero,
  // so "fully_billed" already correctly means "billed everything billable"
  // whether or not short-close was involved, with no separate state needed.
  const billStatus = billedStatus === "fully_billed" ? "finish" : billedStatus === "partial" ? "process" : "wait";
  const payStatus = paidStatus === "fully_paid" ? "finish" : paidStatus === "partial" ? "process" : "wait";
  const receiveLabel =
    receivedStatus === "fully_received"
      ? "Received"
      : receivedStatus === "short_closed"
        ? "Short Closed"
        : receivedStatus === "partial"
          ? "Partially Received"
          : "Not Received";
  const billLabel = billedStatus === "fully_billed" ? "Billed" : billedStatus === "partial" ? "Partially Billed" : "Not Billed";
  const payLabel = paidStatus === "fully_paid" ? "Paid" : paidStatus === "partial" ? "Partially Paid" : "Not Paid";

  // Order's own description deliberately avoids repeating the bare status
  // word ("Issued") already shown by the page's own StatusTag next to the
  // title - both would otherwise render the identical string twice on
  // screen (and break any findByText("Issued") lookup expecting one match).
  const orderLabel = status === "cancelled" ? "Order Cancelled" : status === "draft" ? "Awaiting Issue" : "Order Placed";

  return (
    <Steps
      size="small"
      items={[
        { title: "Order", description: orderLabel, status: orderStatus },
        { title: "Receive", description: receiveLabel, status: receiveStatus },
        { title: "Bill", description: billLabel, status: billStatus },
        { title: "Pay", description: payLabel, status: payStatus },
      ]}
    />
  );
}

interface OutstandingQtyTableProps {
  items: FulfilmentItemRow[];
  /** Which axis this table caps each line to - "received" for the Receipt form, "billed" for the Bill form. */
  axis: "received" | "billed";
  quantities: Record<string, string>;
  onChange: (itemId: string, value: string) => void;
  /** Bill form only: per-line "Bill Amount (USD)" state + setter. purchase_bill_items.billedAmountUsd is a required field the server never derives (purchase-bills.service.ts just parses/rounds whatever the client sends) - omitted entirely for the Receipt form, which has no equivalent line-level amount. */
  amounts?: Record<string, string>;
  onAmountChange?: (itemId: string, value: string) => void;
}

/**
 * Hand-built, not SchemaForm (user-confirmed, PL-4 build discussion): a
 * per-item outstanding-qty-capped grid isn't a shape the 13-field-type
 * registry describes - closer to PurchaseItemsPanel's own read-only Table
 * than to a form. Each line defaults to (and is capped at) its own
 * outstanding quantity so a partial receipt/bill can only ever be entered
 * as partial, never accidentally over-received/over-billed client-side
 * (the server re-checks this regardless - purchase-receipts.service.ts /
 * purchase-bills.service.ts's own guards are the real enforcement).
 */
function OutstandingQtyTable({ items, axis, quantities, onChange, amounts, onAmountChange }: OutstandingQtyTableProps): ReactElement {
  return (
    <Table
      dataSource={items}
      rowKey="id"
      pagination={false}
      size="small"
      columns={[
        { title: "Item", dataIndex: "id", render: (value: string) => value.slice(0, 8) },
        { title: "Ordered", dataIndex: "quantity" },
        {
          title: axis === "received" ? "Already Received" : "Already Billed",
          dataIndex: axis === "received" ? "receivedQuantity" : "billedQuantity",
        },
        {
          title: "Outstanding",
          key: "outstanding",
          render: (_value, row: FulfilmentItemRow) =>
            subtractDecimalStrings(fulfilmentCeiling(row, axis), axis === "received" ? row.receivedQuantity : row.billedQuantity),
        },
        {
          title: axis === "received" ? "Receive Qty" : "Bill Qty",
          key: "input",
          render: (_value, row: FulfilmentItemRow) => {
            const outstanding = subtractDecimalStrings(fulfilmentCeiling(row, axis), axis === "received" ? row.receivedQuantity : row.billedQuantity);
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
        ...(amounts && onAmountChange
          ? [
              {
                title: "Bill Amount (USD)",
                key: "amount",
                render: (_value: unknown, row: FulfilmentItemRow) => (
                  <NumericStringInput
                    id={`amount-${row.id}`}
                    ariaLabel={`Bill amount for item ${row.id}`}
                    value={amounts[row.id] ?? ""}
                    onChange={(next) => {
                      if (next === "" || isPartialNumericString(next)) {
                        onAmountChange(row.id, next);
                      }
                    }}
                    onBlur={() => undefined}
                  />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/**
 * PL-4: opens from the PO's "Receive" action, prefilled with every item's
 * outstanding (ordered - already received) quantity, editable down for a
 * partial receipt. Confirming is a single POST (create the receipt as
 * draft) followed immediately by PATCH .../confirm - PL-1 never built a
 * "save as draft, confirm later" UI step, and the prompt's own acceptance
 * criterion ("Receive action creates a partial receipt") wants one action.
 */
export function PurchaseReceiptForm({
  purchaseId,
  items,
  onDone,
  onClose,
}: {
  purchaseId: string;
  items: Record<string, unknown>[];
  onDone: () => void;
  onClose: () => void;
}): ReactElement {
  const { message } = AntApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  // docs/PO-SHORT-CLOSE.md: a line the supplier already confirmed won't
  // ship the rest (short-closed) has nothing left to receive, even if
  // received < ordered - receivableCeiling() already collapses to plain
  // ordered qty for a line that's never been short-closed.
  const fulfilmentItems = useMemo(
    () => toFulfilmentItems(items).filter((item) => Number(receivableCeiling(item)) > Number(item.receivedQuantity)),
    [items],
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(fulfilmentItems.map((item) => [item.id, subtractDecimalStrings(receivableCeiling(item), item.receivedQuantity)])),
  );

  async function handleSubmit(headerValues: Record<string, unknown>): Promise<void> {
    const lines = fulfilmentItems
      .map((item) => ({ purchaseItemId: item.id, receivedQuantity: quantities[item.id] ?? "" }))
      .filter((line) => line.receivedQuantity !== "" && NUMERIC_STRING_PATTERN.test(line.receivedQuantity) && Number(line.receivedQuantity) > 0);

    if (lines.length === 0) {
      void message.error("Enter a quantity for at least one item");
      return;
    }

    setSubmitting(true);
    try {
      const receipt = await apiFetch<{ id: string }>(endpoints.purchaseReceipts(purchaseId), {
        method: "POST",
        body: { ...headerValues, items: lines },
      });
      await apiFetch(endpoints.confirmPurchaseReceipt(purchaseId, receipt.id), { method: "PATCH" });
      void message.success("Receipt confirmed - stock updated");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  if (fulfilmentItems.length === 0) {
    return <Typography.Text type="secondary">Every item on this purchase has already been fully received.</Typography.Text>;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <OutstandingQtyTable items={fulfilmentItems} axis="received" quantities={quantities} onChange={(id, value) => setQuantities((prev) => ({ ...prev, [id]: value }))} />
      <SchemaForm
        module="purchase"
        entity="receipt"
        mode="create"
        hiddenFields={["receiptNumber"]}
        onSubmit={handleSubmit}
        onDiscard={onClose}
        footer={submitting ? <Typography.Text type="secondary">Confirming receipt…</Typography.Text> : undefined}
      />
    </Space>
  );
}

/**
 * PL-4: opens from the PO's "Convert to Bill" action, prefilled with
 * every item's un-billed (ordered - already billed) quantity. Approving
 * is a single POST (create the bill as draft) followed by PATCH
 * .../approve - same one-action reasoning as the Receipt form above,
 * matching the prompt's "Approving calls PL-2's approve endpoint" wording
 * as the natural conclusion of the SAME user action that created it.
 */
export function PurchaseBillForm({
  purchaseId,
  items,
  onDone,
  onClose,
}: {
  purchaseId: string;
  items: Record<string, unknown>[];
  onDone: () => void;
  onClose: () => void;
}): ReactElement {
  const { message } = AntApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  // docs/PO-SHORT-CLOSE.md, user-confirmed: a line is offered here only
  // while there's still something billable UNDER THE RECEIVED-QTY-AWARE
  // CEILING, not plain ordered qty - billableCeiling() already preserves
  // the zero-receipts pre-shipment-invoice case (ceiling = ordered then).
  const fulfilmentItems = useMemo(
    () => toFulfilmentItems(items).filter((item) => Number(billableCeiling(item)) > Number(item.billedQuantity)),
    [items],
  );
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(fulfilmentItems.map((item) => [item.id, subtractDecimalStrings(billableCeiling(item), item.billedQuantity)])),
  );
  // Defaults to the item's own server-computed purchaseAmountUsd (a
  // pass-through, not a frontend calculation - rule 3) - editable down for
  // a bill that doesn't match the PO's own line amount exactly (the
  // existing vs-PO-total variance display already expects this to happen).
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fulfilmentItems.map((item) => [item.id, item.purchaseAmountUsd])),
  );

  async function handleSubmit(headerValues: Record<string, unknown>): Promise<void> {
    const lines = fulfilmentItems
      .map((item) => ({
        purchaseItemId: item.id,
        billedQuantity: quantities[item.id] ?? "",
        billedAmountUsd: amounts[item.id] ?? "",
      }))
      .filter(
        (line) =>
          line.billedQuantity !== "" &&
          NUMERIC_STRING_PATTERN.test(line.billedQuantity) &&
          Number(line.billedQuantity) > 0 &&
          NUMERIC_STRING_PATTERN.test(line.billedAmountUsd),
      );

    if (lines.length === 0) {
      void message.error("Enter a quantity and amount for at least one item");
      return;
    }

    setSubmitting(true);
    try {
      const bill = await apiFetch<{ id: string }>(endpoints.purchaseInvoices(purchaseId), {
        method: "POST",
        body: { ...headerValues, items: lines },
      });
      await apiFetch(endpoints.approvePurchaseInvoice(purchaseId, bill.id), { method: "PATCH" });
      void message.success("Bill approved");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  if (fulfilmentItems.length === 0) {
    return <Typography.Text type="secondary">Every item on this purchase has already been fully billed.</Typography.Text>;
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <OutstandingQtyTable
        items={fulfilmentItems}
        axis="billed"
        quantities={quantities}
        onChange={(id, value) => setQuantities((prev) => ({ ...prev, [id]: value }))}
        amounts={amounts}
        onAmountChange={(id, value) => setAmounts((prev) => ({ ...prev, [id]: value }))}
      />
      <SchemaForm
        module="purchase"
        entity="invoice"
        mode="create"
        hiddenFields={["invoiceNumber", "invoiceFile"]}
        onSubmit={handleSubmit}
        onDiscard={onClose}
        footer={submitting ? <Typography.Text type="secondary">Approving bill…</Typography.Text> : undefined}
      />
    </Space>
  );
}

/** Wraps both forms above in their own Drawer, driven by the PO detail screen's Receive/Convert to Bill actions - kept here so PurchaseDetailScreen.tsx doesn't grow another two useState/Drawer pairs of its own. */
export function PurchaseFulfilmentDrawer({
  drawer,
  purchaseId,
  items,
  onClose,
  onDone,
}: {
  drawer: "receive" | "bill" | null;
  purchaseId: string;
  items: Record<string, unknown>[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  return (
    <Drawer
      title={drawer === "receive" ? "Receive Items" : "Convert to Bill"}
      open={drawer !== null}
      onClose={onClose}
      width={560}
      destroyOnHidden
    >
      {drawer === "receive" && <PurchaseReceiptForm purchaseId={purchaseId} items={items} onDone={onDone} onClose={onClose} />}
      {drawer === "bill" && <PurchaseBillForm purchaseId={purchaseId} items={items} onDone={onDone} onClose={onClose} />}
    </Drawer>
  );
}

/** The PO detail screen's own Receive/Convert to Bill/Short Close All Remaining buttons - permission-gated (<Can/>, frontend rule 4), only shown once Issued (draft has nothing to receive/bill/short-close against yet). */
export function PurchaseFulfilmentActions({
  issued,
  receivedStatus,
  billedStatus,
  onReceive,
  onBill,
  onShortCloseRemaining,
}: {
  issued: boolean;
  receivedStatus: string;
  billedStatus: string;
  onReceive: () => void;
  onBill: () => void;
  /** docs/PO-SHORT-CLOSE.md's PO-level convenience - only offered while there's at least one line still genuinely partial (received_status partial/not_received doesn't rule this out on its own, so PurchaseDetailScreen passes true only when it's actually found a partial line among the items). Omit entirely (rather than always rendering disabled) when there's nothing to short-close - matches Receive/Convert to Bill's own "hide, don't disable" convention above. */
  onShortCloseRemaining?: () => void;
}): ReactElement | null {
  if (!issued) {
    return null;
  }
  // docs/PO-SHORT-CLOSE.md: "short_closed" (PO-level) means every line is
  // either fully received or short-closed - nothing genuinely pending
  // anywhere, same as "fully_received" for the purpose of "is there
  // anything left to Receive". A PO with SOME lines still partial (mixed)
  // stays "partial" at this level and correctly keeps the button.
  const nothingLeftToReceive = receivedStatus === "fully_received" || receivedStatus === "short_closed";
  // docs/PO-SHORT-CLOSE.md: "fully_billed" already means "billed against
  // whatever the real ceiling is" (computeBilledStatus accounts for
  // short-close in the ceiling itself, no separate billed-axis state).
  const nothingLeftToBill = billedStatus === "fully_billed";
  return (
    <Space>
      {!nothingLeftToReceive && (
        <Can permission="purchase.receipt.create">
          <Button onClick={onReceive}>Receive</Button>
        </Can>
      )}
      {!nothingLeftToBill && (
        <Can permission="purchase.invoice.create">
          <Button onClick={onBill}>Convert to Bill</Button>
        </Can>
      )}
      {onShortCloseRemaining && (
        <Can permission="purchase.line.shortclose">
          <Button onClick={onShortCloseRemaining}>Short Close All Remaining</Button>
        </Can>
      )}
    </Space>
  );
}

/** docs/PO-SHORT-CLOSE.md: a purchase_item's own lineStatus, rendered distinctly from the plain "Partial"/"Fully Received" wording elsewhere in this file - "Short Closed - 3 of 10 not received" makes the written-off remainder visible at a glance, not just a bare status word. */
export function LineStatusTag({ lineStatus, quantity, shortClosedQty }: { lineStatus: string; quantity: string; shortClosedQty: string }): ReactElement {
  if (lineStatus === "short_closed") {
    return (
      <Tag color="orange">
        Short Closed — {shortClosedQty} of {quantity} not received
      </Tag>
    );
  }
  const labelByStatus: Record<string, string> = { open: "Open", partial: "Partial", fully_received: "Fully Received" };
  const colorByStatus: Record<string, string> = { open: "default", partial: "blue", fully_received: "green" };
  return <Tag color={colorByStatus[lineStatus] ?? "default"}>{labelByStatus[lineStatus] ?? lineStatus}</Tag>;
}

/**
 * docs/PO-SHORT-CLOSE.md: the per-line Short Close action - a small Drawer
 * (matching every other action in this file's own Drawer-not-Modal
 * convention) showing ordered/received/would-be-short-closed quantities, a
 * required reason, and a confirm button. Only rendered by the caller when
 * the line's own lineStatus is "partial" (nothing to short-close
 * otherwise - purchase-line-shortclose.service.ts's own guards reject
 * fully-received or zero-receipt lines regardless, this just avoids
 * offering a button that would always 409).
 */
export function ShortCloseLineAction({
  purchaseId,
  itemId,
  quantity,
  receivedQuantity,
  onDone,
}: {
  purchaseId: string;
  itemId: string;
  quantity: string;
  receivedQuantity: string;
  onDone: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();
  const wouldBeShortClosedQty = subtractDecimalStrings(quantity, receivedQuantity);

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    try {
      await apiFetch(endpoints.shortClosePurchaseLine(purchaseId, itemId), { method: "POST", body: { reason } });
      void message.success("Line short-closed");
      setOpen(false);
      setReason("");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Can permission="purchase.line.shortclose">
        <Button size="small" onClick={() => setOpen(true)}>
          Short Close
        </Button>
      </Can>
      <Drawer title="Short Close Line" open={open} onClose={() => setOpen(false)} width={420} destroyOnHidden>
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Text>
            Ordered: {quantity}
            <br />
            Received: {receivedQuantity}
            <br />
            Will be written off as not coming: {wouldBeShortClosedQty}
          </Typography.Text>
          <Input.TextArea
            id="short-close-reason"
            aria-label="Reason"
            placeholder="Why is the remainder not coming? (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
          <Button type="primary" disabled={reason.trim().length === 0} loading={submitting} onClick={() => void handleConfirm()}>
            Confirm Short Close
          </Button>
        </Space>
      </Drawer>
    </>
  );
}

/** docs/PO-SHORT-CLOSE.md §5, user-confirmed: reversible with a dedicated permission - a plain Popconfirm (no reason needed to undo, unlike short-close itself) since reopening just restores the line to Partial rather than making a new audited decision. */
export function ReopenLineAction({ purchaseId, itemId, onDone }: { purchaseId: string; itemId: string; onDone: () => void }): ReactElement {
  const { message } = AntApp.useApp();
  const [submitting, setSubmitting] = useState(false);

  async function handleReopen(): Promise<void> {
    setSubmitting(true);
    try {
      await apiFetch(endpoints.reopenPurchaseLine(purchaseId, itemId), { method: "POST" });
      void message.success("Line reopened");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Can permission="purchase.line.reopen">
      <Popconfirm title="Reopen this line?" okText="Reopen" cancelText="Cancel" onConfirm={() => void handleReopen()}>
        <Button size="small" loading={submitting}>
          Reopen
        </Button>
      </Popconfirm>
    </Can>
  );
}

/** docs/PO-SHORT-CLOSE.md: the PO-level convenience - same required-reason Drawer as ShortCloseLineAction, applied to every currently-partial line at once. */
export function ShortCloseAllRemainingDrawer({
  open,
  purchaseId,
  onClose,
  onDone,
}: {
  open: boolean;
  purchaseId: string;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { message } = AntApp.useApp();

  async function handleConfirm(): Promise<void> {
    setSubmitting(true);
    try {
      const result = await apiFetch<{ items: unknown[] }>(endpoints.shortCloseAllRemaining(purchaseId), { method: "POST", body: { reason } });
      void message.success(`${result.items.length} line(s) short-closed`);
      setReason("");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer title="Short Close All Remaining" open={open} onClose={onClose} width={420} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Finalizes every line still awaiting more stock at its currently received quantity. Fully received and already short-closed lines are left
          untouched.
        </Typography.Text>
        <Input.TextArea
          id="short-close-remaining-reason"
          aria-label="Reason"
          placeholder="Why is the remainder not coming? (required)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
        />
        <Button type="primary" disabled={reason.trim().length === 0} loading={submitting} onClick={() => void handleConfirm()}>
          Confirm Short Close All Remaining
        </Button>
      </Space>
    </Drawer>
  );
}

interface PurchaseOptionRow {
  id: string;
  purchaseNumber: string;
}

/**
 * PL-4 follow-up: Zoho's own "New" button on the standalone Purchase
 * Receives/Bills list screens - a second entry point into the SAME
 * Receive/Convert-to-Bill flow the PO detail screen's own buttons already
 * drive, not a separate creation path. Zoho's own version is Vendor then
 * Purchase Order (two dependent dropdowns); this is a single searchable
 * PO picker instead - purchaseNumber is already unique and Supplier is
 * resolvable from the chosen row, so a separate Vendor-first filter step
 * doesn't earn its own click here. Only ever offers ISSUED purchases with
 * something outstanding on the relevant axis (server-side receivedStatus/
 * billedStatus filters, same ones the PO list's own columns use) - a
 * Draft PO has nothing to receive/bill yet, and a fully-done axis has
 * nothing left either.
 */
function PurchaseOrderPicker({
  axis,
  value,
  onChange,
}: {
  axis: "received" | "billed";
  value: string | undefined;
  onChange: (purchaseId: string) => void;
}): ReactElement {
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const query = useQuery({
    queryKey: ["entity-list", endpoints.purchases, "fulfilment-picker", axis, debouncedSearch],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.purchases, {
          status: "issued",
          [axis === "received" ? "receivedStatus" : "billedStatus"]: axis === "received" ? "not_received" : "not_billed",
          search: debouncedSearch || undefined,
          pageSize: "20",
        }),
        {},
        { schema: paginatedRowsResponseSchema },
      ),
  });

  // "not_received"/"not_billed" alone would hide a PARTIALLY fulfilled PO,
  // which still has outstanding qty too - a second query for "partial"
  // covers that half, merged client-side. Two small requests rather than
  // a third server-side filter value ("has_outstanding") that nothing
  // else needs.
  const partialQuery = useQuery({
    queryKey: ["entity-list", endpoints.purchases, "fulfilment-picker-partial", axis, debouncedSearch],
    queryFn: () =>
      apiFetch(
        withQuery(endpoints.purchases, {
          status: "issued",
          [axis === "received" ? "receivedStatus" : "billedStatus"]: "partial",
          search: debouncedSearch || undefined,
          pageSize: "20",
        }),
        {},
        { schema: paginatedRowsResponseSchema },
      ),
  });

  const rawRows = [...(query.data?.items ?? []), ...(partialQuery.data?.items ?? [])];
  const options = rawRows
    .map((row): PurchaseOptionRow | undefined => {
      const id = asDisplayString(row.id);
      const purchaseNumber = asDisplayString(row.purchaseNumber);
      return id && purchaseNumber ? { id, purchaseNumber } : undefined;
    })
    .filter((row): row is PurchaseOptionRow => row !== undefined)
    .map((row) => ({ value: row.id, label: row.purchaseNumber }));

  return (
    <Select
      style={{ width: "100%" }}
      placeholder="Select a Purchase Order"
      showSearch
      filterOption={false}
      value={value ?? null}
      onSearch={setSearchInput}
      onChange={onChange}
      options={options}
      loading={query.isFetching || partialQuery.isFetching}
      notFoundContent={query.isFetching || partialQuery.isFetching ? "Searching…" : "No matching purchase orders"}
    />
  );
}

function usePurchaseAggregate(purchaseId: string | undefined) {
  return useQuery({
    queryKey: ["purchases", purchaseId],
    queryFn: () => apiFetch<{ id: string; items?: Record<string, unknown>[] }>(`${endpoints.purchases}/${purchaseId}`),
    enabled: Boolean(purchaseId),
  });
}

/** Wraps PurchaseReceiptForm behind its own PO picker - the "New" button on PurchaseReceiptsListScreen. */
export function NewPurchaseReceiptDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): ReactElement {
  const [purchaseId, setPurchaseId] = useState<string | undefined>(undefined);
  const purchaseQuery = usePurchaseAggregate(purchaseId);

  function handleClose(): void {
    setPurchaseId(undefined);
    onClose();
  }

  return (
    <Drawer title="New Purchase Receive" open={open} onClose={handleClose} width={560} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <PurchaseOrderPicker axis="received" value={purchaseId} onChange={setPurchaseId} />
        {purchaseId && purchaseQuery.isLoading && <Spin />}
        {purchaseId && purchaseQuery.data && (
          <PurchaseReceiptForm
            purchaseId={purchaseId}
            items={purchaseQuery.data.items ?? []}
            onDone={() => {
              setPurchaseId(undefined);
              onDone();
            }}
            onClose={handleClose}
          />
        )}
      </Space>
    </Drawer>
  );
}

/** Wraps PurchaseBillForm behind its own PO picker - the "New" button on PurchaseBillsListScreen. */
export function NewPurchaseBillDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): ReactElement {
  const [purchaseId, setPurchaseId] = useState<string | undefined>(undefined);
  const purchaseQuery = usePurchaseAggregate(purchaseId);

  function handleClose(): void {
    setPurchaseId(undefined);
    onClose();
  }

  return (
    <Drawer title="New Bill" open={open} onClose={handleClose} width={560} destroyOnHidden>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <PurchaseOrderPicker axis="billed" value={purchaseId} onChange={setPurchaseId} />
        {purchaseId && purchaseQuery.isLoading && <Spin />}
        {purchaseId && purchaseQuery.data && (
          <PurchaseBillForm
            purchaseId={purchaseId}
            items={purchaseQuery.data.items ?? []}
            onDone={() => {
              setPurchaseId(undefined);
              onDone();
            }}
            onClose={handleClose}
          />
        )}
      </Space>
    </Drawer>
  );
}
