import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { App as AntApp, Button, Drawer, Space, Table, Typography } from "antd";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { Can } from "../../core/permissions/Can";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { NumericStringInput } from "../../core/schema-form/field-types/NumericStringInput";
import { isPartialNumericString, NUMERIC_STRING_PATTERN } from "../../core/schema-form/numeric-string";

interface FulfilmentItemRow {
  id: string;
  deliveredQty: string;
  invoicedQty: string;
}

/** decimal.js would be overkill for a plain subtraction of two already-server-computed decimal strings with the same scale - display-only outstanding qty, recomputed server-side for real at invoice-create time regardless (sales-invoices.service.ts's own over-invoicing guard). Mirrors SalesFulfilmentPanels.tsx's own subtractDecimalStrings exactly. */
function subtractDecimalStrings(a: string, b: string): string {
  const result = Number(a || "0") - Number(b || "0");
  return (Number.isFinite(result) ? Math.max(result, 0) : 0).toString();
}

interface OutstandingQtyTableProps {
  items: FulfilmentItemRow[];
  quantities: Record<string, string>;
  onChange: (itemId: string, value: string) => void;
  amounts: Record<string, string>;
  onAmountChange: (itemId: string, value: string) => void;
}

/**
 * S-5 (docs/SALES-MODULE-PLAN.md): mirrors SalesFulfilmentPanels.tsx's own
 * OutstandingQtyTable, capped at delivered-minus-invoiced (docs/adr/0028's
 * own ceiling), plus a per-line "Invoiced Amount (USD)" input - mirrors
 * PurchaseFulfilmentPanels.tsx's own Bill form (the one other document
 * with a per-line amount alongside quantity). Items here are entirely
 * optional (an itemless invoice is still valid - "invoice independent of
 * delivery") - this table is simply skipped when there's nothing
 * delivered yet.
 */
function OutstandingQtyTable({ items, quantities, onChange, amounts, onAmountChange }: OutstandingQtyTableProps): ReactElement {
  return (
    <Table
      dataSource={items}
      rowKey="id"
      pagination={false}
      size="small"
      columns={[
        { title: "Item", dataIndex: "id", render: (value: string) => value.slice(0, 8) },
        { title: "Delivered", dataIndex: "deliveredQty" },
        { title: "Already Invoiced", dataIndex: "invoicedQty" },
        {
          title: "Outstanding",
          key: "outstanding",
          render: (_value, row: FulfilmentItemRow) => subtractDecimalStrings(row.deliveredQty, row.invoicedQty),
        },
        {
          title: "Invoice Qty",
          key: "qtyInput",
          render: (_value, row: FulfilmentItemRow) => {
            const outstanding = subtractDecimalStrings(row.deliveredQty, row.invoicedQty);
            const value = quantities[row.id] ?? "";
            const overCap = value !== "" && NUMERIC_STRING_PATTERN.test(value) && Number(value) > Number(outstanding);
            return (
              <NumericStringInput
                id={`qty-${row.id}`}
                ariaLabel={`Invoice quantity for item ${row.id}`}
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
        {
          title: "Invoiced Amount (USD)",
          key: "amountInput",
          render: (_value, row: FulfilmentItemRow) => (
            <NumericStringInput
              id={`amount-${row.id}`}
              ariaLabel={`Invoiced amount for item ${row.id}`}
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
      ]}
    />
  );
}

/**
 * S-5: opens from the Sales Order's "Invoice" action. Itemizing is
 * optional - a header-only invoice (no lines picked) is still a valid,
 * approvable document (docs/adr/0028's "invoice independent of delivery").
 * Creating is a single POST (create as draft) followed immediately by
 * PATCH .../approve - same one-action reasoning as Delivery/Bill's own
 * forms.
 */
export function SalesInvoiceForm({
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
  const fulfilmentItems = useMemo(() => items.filter((item) => Number(item.deliveredQty) > Number(item.invoicedQty)), [items]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  async function handleSubmit(headerValues: Record<string, unknown>): Promise<void> {
    const lines = fulfilmentItems
      .map((item) => ({
        salesItemId: item.id,
        invoicedQuantity: quantities[item.id] ?? "",
        invoicedAmountUsd: amounts[item.id] ?? "",
      }))
      .filter(
        (line) =>
          line.invoicedQuantity !== "" &&
          NUMERIC_STRING_PATTERN.test(line.invoicedQuantity) &&
          Number(line.invoicedQuantity) > 0 &&
          NUMERIC_STRING_PATTERN.test(line.invoicedAmountUsd),
      );

    setSubmitting(true);
    try {
      const invoice = await apiFetch<{ id: string }>(endpoints.salesInvoices(salesId), {
        method: "POST",
        body: { ...headerValues, ...(lines.length > 0 ? { items: lines } : {}) },
      });
      await apiFetch(endpoints.approveSalesInvoice(salesId, invoice.id), { method: "PATCH" });
      void message.success("Invoice approved");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {fulfilmentItems.length > 0 ? (
        <OutstandingQtyTable
          items={fulfilmentItems}
          quantities={quantities}
          onChange={(id, value) => setQuantities((prev) => ({ ...prev, [id]: value }))}
          amounts={amounts}
          onAmountChange={(id, value) => setAmounts((prev) => ({ ...prev, [id]: value }))}
        />
      ) : (
        <Typography.Text type="secondary">
          Nothing delivered yet (or everything delivered is already invoiced) - this will be a header-only invoice.
        </Typography.Text>
      )}
      <SchemaForm
        module="sales"
        entity="invoice"
        mode="create"
        hiddenFields={["invoiceNumber"]}
        onSubmit={handleSubmit}
        onDiscard={onClose}
        footer={submitting ? <Typography.Text type="secondary">Approving invoice…</Typography.Text> : undefined}
      />
    </Space>
  );
}

/** Wraps SalesInvoiceForm in its own Drawer, driven by the Sales Order detail screen's Invoice action - mirrors SalesFulfilmentDrawer. */
export function SalesInvoiceDrawer({
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
    <Drawer title="Invoice" open={open} onClose={onClose} width={640} destroyOnHidden>
      <SalesInvoiceForm salesId={salesId} items={items} onDone={onDone} onClose={onClose} />
    </Drawer>
  );
}

/** The Sales Order detail screen's own Invoice button - permission-gated (<Can/>, frontend rule 4), only shown once Approved. Unlike Delivery/SalesFulfilmentActions, this stays available even at fully_delivered (multiple partial invoices are allowed) and even at not_delivered (invoice independent of delivery) - so no deliveredStatus/invoicedStatus gate here, just "approved and not yet closed". */
export function SalesInvoiceAction({ approved, onInvoice }: { approved: boolean; onInvoice: () => void }): ReactElement | null {
  if (!approved) {
    return null;
  }
  return (
    <Can permission="sales.invoice.create">
      <Button onClick={onInvoice}>Invoice</Button>
    </Can>
  );
}
