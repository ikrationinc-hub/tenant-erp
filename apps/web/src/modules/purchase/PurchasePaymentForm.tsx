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

interface OutstandingBillRow {
  id: string;
  purchaseNumber: string;
  billNumber: string;
  billDate: string;
  dueDate: string | null;
  billAmountUsd: string;
  paidAmountUsd: string;
  outstandingAmountUsd: string;
}

function useSupplierOptions() {
  const query = useQuery({
    queryKey: ["field-options", endpoints.supplierOptions],
    queryFn: () => apiFetch(endpoints.supplierOptions, {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  return query.data?.options ?? [];
}

function useOutstandingBills(supplierId: string | undefined) {
  return useQuery({
    queryKey: ["outstanding-bills", supplierId],
    queryFn: () => apiFetch<{ items: OutstandingBillRow[] }>(endpoints.outstandingBillsForSupplier(supplierId ?? "")),
    enabled: Boolean(supplierId),
  });
}

interface AllocationTableProps {
  bills: OutstandingBillRow[];
  amounts: Record<string, string>;
  onChange: (billId: string, value: string) => void;
}

/**
 * PL-5: hand-built, not SchemaForm - same reasoning as the Receipt/Bill
 * forms' own outstanding-qty-capped grids (Receive Qty/Bill Qty), just
 * capped by outstanding AMOUNT rather than quantity. Each line defaults
 * empty (not prefilled to the full outstanding balance) since a payment
 * covering several bills at once is the norm this form supports, and
 * assuming "pay this bill in full" per row would make the common
 * partial-across-several-bills case require more editing than a
 * deliberate opt-in per bill.
 */
function AllocationTable({ bills, amounts, onChange }: AllocationTableProps): ReactElement {
  return (
    <Table
      dataSource={bills}
      rowKey="id"
      pagination={false}
      size="small"
      columns={[
        { title: "Purchase Order", dataIndex: "purchaseNumber" },
        { title: "Bill #", dataIndex: "billNumber" },
        { title: "Bill Date", dataIndex: "billDate" },
        { title: "Outstanding (USD)", dataIndex: "outstandingAmountUsd" },
        {
          title: "Amount to Pay (USD)",
          key: "amount",
          render: (_value, row: OutstandingBillRow) => {
            const value = amounts[row.id] ?? "";
            const overCap = value !== "" && NUMERIC_STRING_PATTERN.test(value) && Number(value) > Number(row.outstandingAmountUsd);
            return (
              <NumericStringInput
                id={`amount-${row.id}`}
                ariaLabel={`Amount to pay for bill ${row.billNumber}`}
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
 * PL-5: Zoho's own "Record Payment" flow - Supplier first (a Payment is
 * scoped to a supplier, not a single PO/Bill), then every one of that
 * supplier's outstanding (approved, not-yet-fully-paid) bills, each with
 * its own amount-to-pay input, then the header fields (date/mode/
 * reference/notes) via SchemaForm. supplierId itself is asked here,
 * OUTSIDE SchemaForm - the allocation grid below needs its value live to
 * fetch outstanding bills, and SchemaForm only ever exposes final values
 * at submit time - so it's hidden from the SchemaForm's own fields and
 * merged back in at submit.
 */
export function PurchasePaymentForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }): ReactElement {
  const { message } = AntApp.useApp();
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const supplierOptions = useSupplierOptions();
  const outstandingQuery = useOutstandingBills(supplierId);
  const bills = outstandingQuery.data?.items ?? [];

  function handleSupplierChange(value: string): void {
    setSupplierId(value);
    setAmounts({});
  }

  async function handleSubmit(headerValues: Record<string, unknown>): Promise<void> {
    if (!supplierId) {
      void message.error("Select a supplier first");
      return;
    }
    const allocations = bills
      .map((bill) => ({ billId: bill.id, appliedAmountUsd: amounts[bill.id] ?? "" }))
      .filter((allocation) => allocation.appliedAmountUsd !== "" && NUMERIC_STRING_PATTERN.test(allocation.appliedAmountUsd) && Number(allocation.appliedAmountUsd) > 0);

    if (allocations.length === 0) {
      void message.error("Enter an amount to pay for at least one bill");
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(endpoints.payments, {
        method: "POST",
        body: { ...headerValues, supplierId, allocations },
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
        <Typography.Text strong id="payment-supplier-label">
          Supplier
        </Typography.Text>
        <Select
          aria-labelledby="payment-supplier-label"
          style={{ width: "100%", marginTop: 4 }}
          placeholder="Select a Supplier"
          showSearch
          filterOption={(input, option) => asDisplayString(option?.label).toLowerCase().includes(input.toLowerCase())}
          value={supplierId ?? null}
          onChange={handleSupplierChange}
          options={supplierOptions}
        />
      </div>

      {supplierId && outstandingQuery.isLoading && <Spin />}
      {supplierId && outstandingQuery.data && bills.length === 0 && (
        <Typography.Text type="secondary">This supplier has no outstanding bills to pay.</Typography.Text>
      )}
      {supplierId && bills.length > 0 && (
        <>
          <AllocationTable bills={bills} amounts={amounts} onChange={(id, value) => setAmounts((prev) => ({ ...prev, [id]: value }))} />
          <SchemaForm
            module="purchase"
            entity="payment"
            mode="create"
            hiddenFields={["paymentNumber", "supplierId"]}
            onSubmit={handleSubmit}
            onDiscard={onClose}
            footer={submitting ? <Typography.Text type="secondary">Recording payment…</Typography.Text> : undefined}
          />
        </>
      )}
    </Space>
  );
}

/** Wraps PurchasePaymentForm in its own Drawer - the "New" button on PurchasePaymentsListScreen. */
export function NewPaymentDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): ReactElement {
  return (
    <Drawer title="Record Payment" open={open} onClose={onClose} width={720} destroyOnHidden>
      <PurchasePaymentForm onDone={onDone} onClose={onClose} />
    </Drawer>
  );
}
