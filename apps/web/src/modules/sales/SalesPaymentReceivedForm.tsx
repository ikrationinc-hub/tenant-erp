import type { ReactElement } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Drawer, Select, Space, Spin, Table, Typography } from "antd";
import { masterOptionsResponseSchema } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { NumericStringInput } from "../../core/schema-form/field-types/NumericStringInput";
import { isPartialNumericString, NUMERIC_STRING_PATTERN } from "../../core/schema-form/numeric-string";

function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

interface OutstandingInvoiceRow {
  id: string;
  salesNumber: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  invoiceAmountUsd: string;
  paidAmountUsd: string;
  outstandingAmountUsd: string;
}

function useCustomerOptions() {
  const query = useQuery({
    queryKey: ["field-options", endpoints.customerOptions],
    queryFn: () => apiFetch(endpoints.customerOptions, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

function useOutstandingInvoices(customerId: string | undefined) {
  return useQuery({
    queryKey: ["outstanding-invoices", customerId],
    queryFn: () => apiFetch<{ items: OutstandingInvoiceRow[] }>(endpoints.outstandingInvoicesForCustomer(customerId ?? "")),
    enabled: Boolean(customerId),
  });
}

interface AllocationTableProps {
  invoices: OutstandingInvoiceRow[];
  amounts: Record<string, string>;
  onChange: (invoiceId: string, value: string) => void;
}

/** S-5: mirrors PurchasePaymentForm.tsx's own AllocationTable exactly, substituting invoice/sale for bill/purchase. Each line defaults empty - a payment covering several invoices at once is the norm this form supports. */
function AllocationTable({ invoices, amounts, onChange }: AllocationTableProps): ReactElement {
  return (
    <Table
      dataSource={invoices}
      rowKey="id"
      pagination={false}
      size="small"
      columns={[
        { title: "Sales Order", dataIndex: "salesNumber" },
        { title: "Invoice #", dataIndex: "invoiceNumber" },
        { title: "Invoice Date", dataIndex: "invoiceDate" },
        { title: "Outstanding (USD)", dataIndex: "outstandingAmountUsd" },
        {
          title: "Amount to Apply (USD)",
          key: "amount",
          render: (_value, row: OutstandingInvoiceRow) => {
            const value = amounts[row.id] ?? "";
            const overCap = value !== "" && NUMERIC_STRING_PATTERN.test(value) && Number(value) > Number(row.outstandingAmountUsd);
            return (
              <NumericStringInput
                id={`amount-${row.id}`}
                ariaLabel={`Amount to apply for invoice ${row.invoiceNumber}`}
                value={value}
                onChange={(next) => {
                  if (next === "" || isPartialNumericString(next)) {
                    onChange(row.id, next);
                  }
                }}
                onBlur={() => {
                  if (overCap) {
                    onChange(row.id, row.outstandingAmountUsd);
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
 * S-5: Zoho's own "Record Payment" flow, mirrored on the receivables side
 * - Customer first (a Payment Received is scoped to a customer, not a
 * single Sales Order/Invoice), then every one of that customer's
 * outstanding (approved, not-yet-fully-paid) invoices, each with its own
 * amount-to-apply input, then the header fields (date/mode/reference/
 * notes) via SchemaForm. Mirrors PurchasePaymentForm.tsx exactly.
 */
export function SalesPaymentReceivedForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }): ReactElement {
  const { message } = AntApp.useApp();
  const [customerId, setCustomerId] = useState<string | undefined>(undefined);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const customerOptions = useCustomerOptions();
  const outstandingQuery = useOutstandingInvoices(customerId);
  const invoices = outstandingQuery.data?.items ?? [];

  function handleCustomerChange(value: string): void {
    setCustomerId(value);
    setAmounts({});
  }

  async function handleSubmit(headerValues: Record<string, unknown>): Promise<void> {
    if (!customerId) {
      void message.error("Select a customer first");
      return;
    }
    const allocations = invoices
      .map((invoice) => ({ invoiceId: invoice.id, appliedAmountUsd: amounts[invoice.id] ?? "" }))
      .filter(
        (allocation) => allocation.appliedAmountUsd !== "" && NUMERIC_STRING_PATTERN.test(allocation.appliedAmountUsd) && Number(allocation.appliedAmountUsd) > 0,
      );

    if (allocations.length === 0) {
      void message.error("Enter an amount to apply for at least one invoice");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(endpoints.paymentsReceived, {
        method: "POST",
        body: { ...headerValues, customerId, allocations },
      });
      void message.success("Payment recorded");
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <div>
        <Typography.Text strong id="payment-received-customer-label">
          Customer
        </Typography.Text>
        <Select
          aria-labelledby="payment-received-customer-label"
          style={{ width: "100%", marginTop: 4 }}
          placeholder="Select a Customer"
          showSearch
          filterOption={(input, option) => asDisplayString(option?.label).toLowerCase().includes(input.toLowerCase())}
          value={customerId ?? null}
          onChange={handleCustomerChange}
          options={customerOptions}
        />
      </div>

      {customerId && outstandingQuery.isLoading && <Spin />}
      {customerId && outstandingQuery.data && invoices.length === 0 && (
        <Typography.Text type="secondary">This customer has no outstanding invoices to pay.</Typography.Text>
      )}
      {customerId && invoices.length > 0 && (
        <>
          <AllocationTable invoices={invoices} amounts={amounts} onChange={(id, value) => setAmounts((prev) => ({ ...prev, [id]: value }))} />
          <SchemaForm
            module="sales"
            entity="receipt"
            mode="create"
            hiddenFields={["paymentNumber"]}
            onSubmit={handleSubmit}
            onDiscard={onClose}
            footer={submitting ? <Typography.Text type="secondary">Recording payment…</Typography.Text> : undefined}
          />
        </>
      )}
    </Space>
  );
}

/** Wraps SalesPaymentReceivedForm in its own Drawer - the "New" button on SalesPaymentsReceivedListScreen. */
export function NewPaymentReceivedDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): ReactElement {
  return (
    <Drawer title="Record Payment" open={open} onClose={onClose} width={720} destroyOnHidden>
      <SalesPaymentReceivedForm onDone={onDone} onClose={onClose} />
    </Drawer>
  );
}
