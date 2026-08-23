import type { ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Button, Card, Drawer, Popconfirm, Space, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { listAttachmentsResponseSchema, masterOptionsResponseSchema, type AttachmentRow } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { openAttachmentDownload } from "../../core/attachments/download-attachment";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { Can } from "../../core/permissions/Can";
import { useHasPermission } from "../../core/permissions/use-permissions";
import { StatusTag } from "../../core/status-tag/StatusTag";
import { INVOICE_STATUS_COLORS, PURCHASE_STATUS_COLORS } from "../../core/status-tag/status-colors";
import { PURCHASE_LIST_PATH } from "./PurchaseListScreen";

const MULTI_UPLOAD_ATTACHMENT_KEYS = new Set(["otherDocuments", "otherDocuments2"]);

/** Same pattern as PurchaseListScreen/SupplierScreen's useMasterOptions - a select field backed by a masters:X optionsSource stores the master's row id, not a label, so every sub-panel table here needs its own resolved-value -> label lookup (SchemaForm's Dropdown does this too, but via use-field-options.ts, which a plain read-only Table doesn't go through). */
function useMasterLabels(master: string): Map<string, string> {
  const query = useQuery({
    queryKey: ["field-options", master],
    queryFn: () => apiFetch(endpoints.masterOptions(master), {}, { schema: masterOptionsResponseSchema }),
    staleTime: 5 * 60_000,
  });
  const options = query.data?.options ?? [];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- options is a fresh array every render (query.data?.options ?? []); re-keying on it would rebuild the Map every render for no reason. staleTime already keeps query.data itself stable across re-renders until it actually changes.
  return useMemo(() => new Map(options.map((option) => [option.value, option.label])), [query.data]);
}

function resolvedLabel(labels: Map<string, string>, value: unknown): string {
  const id = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return labels.get(id) ?? id;
}

/**
 * FileUpload/MultiUpload fields only round-trip whatever their own
 * onChange has set (field-value-utils.ts's UploadedFileValue shape) -
 * without this, reopening an existing purchase shows "No file" for every
 * attachment uploaded in an earlier session, even though the row is
 * still there server-side. Groups GET /attachments' flat list back into
 * the per-field shape each widget expects: a single {uid, name} for a
 * FileUpload field, an array for a MultiUpload field.
 */
function attachmentInitialValues(attachments: AttachmentRow[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const attachment of attachments) {
    const file = { uid: attachment.id, name: attachment.filename };
    if (MULTI_UPLOAD_ATTACHMENT_KEYS.has(attachment.fieldKey)) {
      const existing = Array.isArray(values[attachment.fieldKey]) ? (values[attachment.fieldKey] as unknown[]) : [];
      values[attachment.fieldKey] = [...existing, file];
    } else {
      values[attachment.fieldKey] = file;
    }
  }
  return values;
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

const ATTACHMENT_KEYS = new Set([
  "invoice",
  "billOfLading",
  "packingList",
  "certificateOfOrigin",
  "otherDocuments",
  "otherDocuments2",
]);

/** createPurchaseSchema/updatePurchaseSchema are both `.strict()` - purchaseNumber/status are system-controlled, attachments go through their own API. (An empty-string optional, e.g. a UUID Dropdown left blank, is already stripped by SchemaForm itself before onSubmit ever fires - see stripEmptyOptionalFields.) */
function splitHeaderPayload(values: Record<string, unknown>): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  const shipment: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "purchaseNumber" || ATTACHMENT_KEYS.has(key)) {
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

interface PurchaseAggregate {
  id: string;
  status: "draft" | "approved" | "posted";
  [key: string]: unknown;
}

function rowsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

/** A field pulled off an `unknown`-indexed aggregate could be anything - only ever render it as text if it actually is text/number. */
function asDisplayString(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function pricingField(pricing: unknown, key: string): unknown {
  if (typeof pricing !== "object" || pricing === null || !(key in pricing)) {
    return undefined;
  }
  return (pricing as Record<string, unknown>)[key];
}

/**
 * FE-6's "big one". Header+Shipment (A/B/C) is one SchemaForm submitted as
 * a nested payload; Items/Allocations/LME/Hedges (D/F/Sub Tab 3) are each
 * their own add-only sub-panel over the real per-sub-resource endpoints
 * (purchase.routes.ts never accepted a single giant nested create - FR-104
 * says items are added, not declared upfront); Costs (G) is a single
 * upsert form. Posted (rule 8) renders every one of these read-only.
 */
export function PurchaseDetailScreen({
  mode,
  purchaseId,
}: {
  mode: "create" | "edit";
  purchaseId?: string;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const customerLabels = useMasterLabels("customers");
  // A Viewer (read-only role, missing purchase.po.create/update) was
  // getting an editable Header/Shipment form and Additional Cost form on
  // any non-posted purchase - the mode/readOnly calculations below only
  // ever checked `posted` (rule 8's immutability), never the signed-in
  // user's own permission. Every sub-panel's own Add/Close button was
  // already correctly gated by <Can>/useHasPermission; these two weren't.
  const canCreate = useHasPermission("purchase.po.create");
  const canUpdate = useHasPermission("purchase.po.update");
  const canEditHeader = mode === "create" ? canCreate : canUpdate;

  const purchaseQuery = useQuery({
    queryKey: ["purchases", purchaseId],
    queryFn: () => apiFetch<PurchaseAggregate>(`${endpoints.purchases}/${purchaseId}`),
    enabled: mode === "edit" && Boolean(purchaseId),
  });

  const attachmentsQuery = useQuery({
    queryKey: ["attachments", "purchase", purchaseId],
    queryFn: () =>
      apiFetch(withQuery(endpoints.attachments, { entity: "purchase", entityId: purchaseId }), {}, {
        schema: listAttachmentsResponseSchema,
      }),
    enabled: mode === "edit" && Boolean(purchaseId),
  });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["purchases", purchaseId] });
    void queryClient.invalidateQueries({ queryKey: ["entity-list", endpoints.purchases] });
  }

  async function handleHeaderSubmit(values: Record<string, unknown>): Promise<void> {
    const payload = splitHeaderPayload(values);
    if (mode === "create") {
      const created = await apiFetch<{ id: string }>(endpoints.purchases, { method: "POST", body: payload });
      void message.success("Purchase created");
      void navigate(`${PURCHASE_LIST_PATH}/${created.id}`, { replace: true });
      return;
    }
    await apiFetch(`${endpoints.purchases}/${purchaseId}`, { method: "PATCH", body: payload });
    void message.success("Purchase updated");
    refresh();
  }

  async function handleApprove(): Promise<void> {
    await apiFetch(endpoints.approvePurchase(purchaseId ?? ""), { method: "PATCH" });
    // Prompt 22: approving the PO no longer moves stock - it's intent
    // only. Stock moves when a supplier invoice against it is approved.
    void message.success("Purchase approved");
    refresh();
  }

  async function handlePost(): Promise<void> {
    await apiFetch(endpoints.postPurchase(purchaseId ?? ""), { method: "PATCH" });
    void message.success("Purchase posted");
    refresh();
  }

  if (mode === "edit" && purchaseQuery.isLoading) {
    return <Spin />;
  }
  if (mode === "edit" && (purchaseQuery.isError || !purchaseQuery.data)) {
    return <Alert type="error" showIcon message="Could not load this purchase" />;
  }

  const purchase = purchaseQuery.data;
  const status = purchase?.status;
  const posted = status === "posted";
  const approved = status === "approved";
  // Header/Items/Costs/Customer Allocation all call assertDraft server-side
  // (purchase.service.ts) - they lock the moment a purchase is Approved,
  // not just once it's Posted. LME Records and Hedges are the deliberate
  // exception (purchase-lme.service.ts/purchase-hedges.service.ts never
  // call assertDraft - open question #6's LME-after-approval flow), so
  // those two panels stay gated on `posted` alone, further down.
  const draft = status === "draft";
  const hasItems = rowsOf(purchase?.items).length > 0;
  // Prompt 21 item 2: under "lme" pricing, item rate comes from the LME
  // record (purchase-items.service.ts's resolveItemRate), not a manual
  // entry - the LME Records section only applies there too.
  const pricingType = asDisplayString(purchase?.pricingType);
  const isLmePricing = pricingType === "lme";
  const headerInitialValues =
    purchase &&
    typeof purchase.shipment === "object" &&
    purchase.shipment !== null
      ? {
          ...purchase,
          ...(purchase.shipment as Record<string, unknown>),
          ...attachmentInitialValues(attachmentsQuery.data?.items ?? []),
        }
      : purchase;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {mode === "create" ? "New Purchase" : `Purchase ${asDisplayString(purchase?.purchaseNumber)}`}
          </Typography.Title>
          {status && <StatusTag value={status} colorMap={PURCHASE_STATUS_COLORS} />}
        </Space>
        {mode === "edit" && purchaseId && (
          <Space>
            {status === "draft" && (
              <Can permission="purchase.po.approve">
                {/* UX nicety only - the server rejects an item-less approve regardless (core/workflow/guards.ts's requireAtLeastOneValidLine), this just avoids a round trip to say so. */}
                <Tooltip title={hasItems ? undefined : "Add at least one item before approving"}>
                  <Button disabled={!hasItems} onClick={() => void handleApprove()}>
                    Approve
                  </Button>
                </Tooltip>
              </Can>
            )}
            {status === "approved" && (
              <Can permission="purchase.po.post">
                <Button type="primary" onClick={() => void handlePost()}>
                  Post
                </Button>
              </Can>
            )}
          </Space>
        )}
      </Space>

      {approved && (
        <Alert
          type="info"
          showIcon
          message="This purchase is approved. Header, costs, and customer allocation are now locked. Items can still be edited - a change here sends any approved supplier invoice back to Draft, requiring re-approval to move stock again. LME pricing and hedging can still be recorded until it's posted."
        />
      )}
      {posted && (
        <Alert
          type="info"
          showIcon
          message="This purchase is posted and immutable. Corrections require a reversal and re-entry."
        />
      )}

      <Card title="Header, Supplier & Shipment" size="small">
        <SchemaForm
          module="purchase"
          entity="header"
          mode={(mode === "edit" && !draft) || !canEditHeader ? "view" : mode === "create" ? "create" : "edit"}
          {...(headerInitialValues ? { initialValues: headerInitialValues } : {})}
          onSubmit={handleHeaderSubmit}
          {...(purchaseId ? { uploadContext: { entity: "purchase", entityId: purchaseId } } : {})}
        />
      </Card>

      {mode === "edit" && purchaseId && purchase && (
        <>
          <PurchaseCostsPanel purchaseId={purchaseId} readOnly={!draft || !canUpdate} onSaved={refresh} costs={purchase.additionalCosts} />
          {isLmePricing && rowsOf(purchase.lmeRecords).length === 0 && draft && (
            <Alert
              type="warning"
              showIcon
              message="This is an LME purchase. Add an LME record below before adding items - the item rate is derived from it."
            />
          )}
          {/* Prompt 22 Part 4: items stay editable through Approved (assertItemsEditable server-side blocks only Posted) - a stock-relevant edit here (add, or a real quantity change) sends any approved invoice back to Draft. */}
          <PurchaseItemsPanel
            purchaseId={purchaseId}
            readOnly={posted}
            onAdded={refresh}
            items={rowsOf(purchase.items)}
            isLmePricing={isLmePricing}
          />
          <PurchaseInvoicesPanel
            purchaseId={purchaseId}
            purchaseDraft={draft}
            onChanged={refresh}
            invoices={rowsOf(purchase.invoices)}
          />
          <PurchaseSubResourceList
            title="Customer Allocation"
            entity="allocation"
            endpoint={endpoints.purchaseAllocations(purchaseId)}
            rowEndpoint={(allocationId) => endpoints.purchaseAllocation(purchaseId, allocationId)}
            addPermission="purchase.po.update"
            editPermission="purchase.po.update"
            deletePermission="purchase.po.update"
            readOnly={!draft}
            rows={rowsOf(purchase.allocations)}
            onAdded={refresh}
            onChanged={refresh}
            columns={[
              {
                title: "Reserved Customer",
                dataIndex: "reservedCustomerId",
                render: (value) => resolvedLabel(customerLabels, value),
              },
              { title: "Allocation %", dataIndex: "allocationPct" },
            ]}
            // Allocation is a SOFT reservation (docs/adr - allocation is
            // intent-only, Sales must never treat it as binding): this
            // running total is informational only, never a validation -
            // the server has no over-100% block to mirror (Prompt 21 item
            // 6), so the UI must not invent one either.
            footer={<AllocationTotal rows={rowsOf(purchase.allocations)} />}
          />
          {isLmePricing && (
            <PurchaseSubResourceList
              title="LME Records"
              entity="lme_record"
              endpoint={endpoints.purchaseLmeRecords(purchaseId)}
              rowEndpoint={(lmeRecordId) => endpoints.purchaseLmeRecord(purchaseId, lmeRecordId)}
              addPermission="purchase.po.create"
              editPermission="purchase.po.update"
              deletePermission="purchase.po.update"
              readOnly={posted}
              // Not gated by the purchase's own status (purchase-lme.service.ts's
              // deliberate design - a price can get fixed even after Approved/
              // Posted); only a per-row "already used by an item" lock applies.
              editDeleteReadOnly={false}
              rowLocked={(row) => (row.isUsed ? "Already used to price an item - add a new, corrected record instead" : undefined)}
              rows={rowsOf(purchase.lmeRecords)}
              onAdded={refresh}
              onChanged={refresh}
              columns={[
                { title: "Metal", dataIndex: "metal" },
                { title: "LME Type", dataIndex: "lmeType" },
                { title: "LME Price (USD)", dataIndex: "lmePriceUsd" },
                { title: "Fixing Date", dataIndex: "fixingDate" },
                { title: "Agreed %", dataIndex: "agreedPremiumPct" },
                { title: "Final Rate (USD)", dataIndex: "finalPurchaseRateUsd" },
              ]}
            />
          )}
          <PurchaseHedgesPanel purchaseId={purchaseId} readOnly={posted} onAdded={refresh} hedges={rowsOf(purchase.hedges)} />
        </>
      )}
    </Space>
  );
}

function PurchaseCostsPanel({
  purchaseId,
  readOnly,
  onSaved,
  costs,
}: {
  purchaseId: string;
  readOnly: boolean;
  onSaved: () => void;
  costs: unknown;
}): ReactElement {
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.purchaseCosts(purchaseId), { method: "PATCH", body: values });
    void message.success("Additional costs saved");
    onSaved();
  }

  return (
    <Card title="Additional Cost" size="small">
      <SchemaForm
        module="purchase"
        entity="po"
        mode={readOnly ? "view" : "edit"}
        initialValues={typeof costs === "object" && costs !== null ? (costs as Record<string, unknown>) : {}}
        onSubmit={handleSubmit}
      />
    </Card>
  );
}

function PurchaseItemsPanel({
  purchaseId,
  readOnly,
  onAdded,
  items,
  isLmePricing,
}: {
  purchaseId: string;
  readOnly: boolean;
  onAdded: () => void;
  items: Record<string, unknown>[];
  isLmePricing: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { message } = AntApp.useApp();
  const itemLabels = useMasterLabels("items");
  const gradeLabels = useMasterLabels("item-grades");
  const uomLabels = useMasterLabels("uom");

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.purchaseItems(purchaseId), { method: "POST", body: values });
    void message.success("Item added");
    setOpen(false);
    onAdded();
  }

  return (
    <Card
      title="Purchase Items & Pricing"
      size="small"
      extra={
        !readOnly && (
          <Can permission="purchase.po.create">
            <Button onClick={() => setOpen(true)}>Add Item</Button>
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
            render: (pricing: unknown) => asDisplayString(pricingField(pricing, "purchaseRateUsd")),
          },
          {
            title: "Amount (USD)",
            dataIndex: "pricing",
            render: (pricing: unknown) => asDisplayString(pricingField(pricing, "purchaseAmountUsd")),
          },
          {
            title: "Amount (AED)",
            dataIndex: "pricing",
            render: (pricing: unknown) => asDisplayString(pricingField(pricing, "purchaseAmountAed")),
          },
        ]}
      />
      <Drawer title="Add Purchase Item" open={open} onClose={() => setOpen(false)} width={420} destroyOnHidden>
        {isLmePricing && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Purchase Rate (USD) is derived from the LME record's final rate and isn't entered manually."
          />
        )}
        <SchemaForm
          module="purchase"
          entity="item"
          mode="create"
          onSubmit={handleSubmit}
          {...(isLmePricing ? { hiddenFields: ["purchaseRateUsd"] } : {})}
        />
      </Drawer>
    </Card>
  );
}

/**
 * Prompt 22 follow-up: purchase.service.ts's getById computes varianceUsd/
 * variancePct server-side (rule 3 - the frontend never calculates money,
 * so this only formats what it's given, never derives it). Informational
 * only, same spirit as ADR 0014's allocation total - never blocks
 * anything here.
 */
function InvoiceVarianceTag({ varianceUsd, variancePct }: { varianceUsd: unknown; variancePct: unknown }): ReactElement {
  const usd = asDisplayString(varianceUsd);
  if (!usd) {
    return <span>—</span>;
  }
  if (/^-?0(\.0+)?$/.test(usd)) {
    return <Tag color="default">Matches PO</Tag>;
  }
  const isNegative = usd.startsWith("-");
  const pct = asDisplayString(variancePct);
  const sign = isNegative ? "" : "+";
  return (
    <Tag color={isNegative ? "blue" : "orange"}>
      {sign}
      {usd}
      {pct ? ` (${sign}${pct}%)` : ""}
    </Tag>
  );
}

/**
 * Prompt 22: THE document that actually moves stock (Part 3) - approving
 * a purchase order no longer does. `purchaseDraft` gates the Approve
 * action: purchase-invoices.service.ts's own guard rejects approving an
 * invoice while its purchase is still Draft, so the button is disabled
 * (with an explanatory tooltip) rather than round-tripping a 409 the
 * user can't act on differently anyway.
 */
function PurchaseInvoicesPanel({
  purchaseId,
  purchaseDraft,
  onChanged,
  invoices,
}: {
  purchaseId: string;
  purchaseDraft: boolean;
  onChanged: () => void;
  invoices: Record<string, unknown>[];
}): ReactElement {
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; invoice: Record<string, unknown> } | null>(null);
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const canCreateInvoice = useHasPermission("purchase.invoice.create");
  const canApproveInvoice = useHasPermission("purchase.invoice.approve");
  const hasDraftInvoice = invoices.some((invoice) => invoice.status === "draft");

  // Single-invoice-by-default (ALLOW_PARTIAL_INVOICING is off server-side,
  // Prompt 22): there's at most one row today, so one attachments query
  // covers both the table's own "Document" column AND the edit drawer's
  // initialValues - same attachmentInitialValues() grouping the header
  // form already relies on to show a previously-uploaded file after a
  // reload (FileUpload/MultiUpload fields only round-trip what their own
  // onChange has set locally; without re-fetching GET /attachments, a
  // freshly reopened form has no way to know a file was ever uploaded).
  const invoiceId = invoices[0]?.id;
  const invoiceIdString = typeof invoiceId === "string" ? invoiceId : "";
  const invoiceAttachmentsQuery = useQuery({
    queryKey: ["attachments", "purchase_invoice", invoiceIdString],
    queryFn: () =>
      apiFetch(withQuery(endpoints.attachments, { entity: "purchase_invoice", entityId: invoiceIdString }), {}, {
        schema: listAttachmentsResponseSchema,
      }),
    enabled: Boolean(invoiceIdString),
  });
  const invoiceFileAttachment = invoiceAttachmentsQuery.data?.items.find((item) => item.fieldKey === "invoiceFile");

  async function handleCreate(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.purchaseInvoices(purchaseId), { method: "POST", body: values });
    void message.success("Supplier invoice created");
    setDrawer(null);
    onChanged();
  }

  async function handleEdit(invoiceId: string, values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.purchaseInvoice(purchaseId, invoiceId), { method: "PATCH", body: values });
    void message.success("Supplier invoice updated");
    setDrawer(null);
    // A file selected during this edit already uploaded live (FileUploadField's
    // own customRequest, independent of this PATCH) - refetch so the table's
    // Document column and the drawer's own initial values pick it up without
    // requiring a full page reload.
    void queryClient.invalidateQueries({ queryKey: ["attachments", "purchase_invoice", invoiceId] });
    onChanged();
  }

  async function handleApprove(invoiceId: string): Promise<void> {
    await apiFetch(endpoints.approvePurchaseInvoice(purchaseId, invoiceId), { method: "PATCH" });
    void message.success("Supplier invoice approved - stock updated");
    onChanged();
  }

  return (
    <Card
      title="Supplier Invoices"
      size="small"
      extra={
        <Can permission="purchase.invoice.create">
          <Button onClick={() => setDrawer({ mode: "create" })}>Add Invoice</Button>
        </Can>
      }
    >
      {invoices.length === 0 && canCreateInvoice && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Add a supplier invoice below to move this purchase's stock into inventory - the purchase order alone never does."
        />
      )}
      {invoices.length > 0 && hasDraftInvoice && canApproveInvoice && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="A supplier invoice has been added - approve it below to move its items into inventory."
        />
      )}
      <Table
        dataSource={invoices}
        rowKey="id"
        pagination={false}
        size="small"
        locale={{ emptyText: "No supplier invoices yet - a purchase order is intent only until one is received, uploaded, and approved." }}
        columns={[
          { title: "Invoice #", dataIndex: "invoiceNumber" },
          { title: "Supplier Ref", dataIndex: "supplierInvoiceNo" },
          { title: "Invoice Date", dataIndex: "invoiceDate" },
          { title: "Amount (USD)", dataIndex: "invoiceAmountUsd", render: (value: unknown) => asDisplayString(value) || "—" },
          {
            title: "vs PO Total",
            key: "variance",
            render: (_value, row): ReactNode => <InvoiceVarianceTag varianceUsd={row.varianceUsd} variancePct={row.variancePct} />,
          },
          {
            title: "Status",
            dataIndex: "status",
            render: (value: unknown) => <StatusTag value={asDisplayString(value)} colorMap={INVOICE_STATUS_COLORS} />,
          },
          {
            title: "Document",
            key: "document",
            render: (): ReactNode =>
              invoiceFileAttachment ? (
                <Typography.Link onClick={() => void openAttachmentDownload(invoiceFileAttachment.id)}>
                  {invoiceFileAttachment.filename}
                </Typography.Link>
              ) : (
                <Typography.Text type="secondary">No file</Typography.Text>
              ),
          },
          {
            title: "",
            key: "actions",
            render: (_value, row): ReactNode =>
              row.status === "draft" ? (
                <Space>
                  <Can permission="purchase.invoice.update">
                    <Button size="small" onClick={() => setDrawer({ mode: "edit", invoice: row })}>
                      Edit
                    </Button>
                  </Can>
                  <Can permission="purchase.invoice.approve">
                    <Tooltip title={purchaseDraft ? "Approve the purchase order first" : undefined}>
                      <Button size="small" type="primary" disabled={purchaseDraft} onClick={() => void handleApprove(String(row.id))}>
                        Approve
                      </Button>
                    </Tooltip>
                  </Can>
                </Space>
              ) : null,
          },
        ]}
      />
      <Drawer
        title={drawer?.mode === "edit" ? "Edit Supplier Invoice" : "Add Supplier Invoice"}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={420}
        destroyOnHidden
      >
        {drawer?.mode === "create" && (
          // invoiceFile hidden here: uploadContext needs a real invoice id,
          // which doesn't exist until this create actually completes -
          // same reasoning as the purchase header's own attachment fields
          // needing purchaseId first. Upload the file from Edit instead.
          <SchemaForm module="purchase" entity="invoice" mode="create" onSubmit={handleCreate} hiddenFields={["invoiceFile"]} />
        )}
        {drawer?.mode === "edit" && (
          <SchemaForm
            module="purchase"
            entity="invoice"
            mode="edit"
            initialValues={{ ...drawer.invoice, ...attachmentInitialValues(invoiceAttachmentsQuery.data?.items ?? []) }}
            onSubmit={(values) => handleEdit(String(drawer.invoice.id), values)}
            uploadContext={{ entity: "purchase_invoice", entityId: String(drawer.invoice.id) }}
          />
        )}
      </Drawer>
    </Card>
  );
}

function PurchaseHedgesPanel({
  purchaseId,
  readOnly,
  onAdded,
  hedges,
}: {
  purchaseId: string;
  readOnly: boolean;
  onAdded: () => void;
  hedges: Record<string, unknown>[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { message } = AntApp.useApp();
  const canUpdate = useHasPermission("purchase.po.update");
  const platformLabels = useMasterLabels("hedge-platforms");

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoints.purchaseHedges(purchaseId), { method: "POST", body: values });
    void message.success("Hedge added");
    setOpen(false);
    onAdded();
  }

  async function closeHedge(hedgeId: string): Promise<void> {
    await apiFetch(endpoints.purchaseHedge(purchaseId, hedgeId), { method: "PATCH", body: { status: "closed" } });
    void message.success("Hedge closed");
    onAdded();
  }

  return (
    <Card
      title="Hedging Details"
      size="small"
      extra={
        !readOnly && (
          <Can permission="purchase.po.create">
            <Button onClick={() => setOpen(true)}>Add Hedge</Button>
          </Can>
        )
      }
    >
      <Table
        dataSource={hedges}
        rowKey="id"
        pagination={false}
        size="small"
        locale={{ emptyText: "No hedges yet" }}
        columns={[
          { title: "Platform", dataIndex: "hedgePlatformId", render: (value) => resolvedLabel(platformLabels, value) },
          { title: "Contract #", dataIndex: "contractNumber" },
          {
            title: "Position",
            dataIndex: "position",
            render: (value: unknown) => {
              const position = asDisplayString(value);
              return (
                <Tag color={position === "buy" ? "green" : position === "sell" ? "red" : "default"}>
                  {position ? position.charAt(0).toUpperCase() + position.slice(1) : "—"}
                </Tag>
              );
            },
          },
          { title: "Quantity", dataIndex: "quantity" },
          { title: "Rate", dataIndex: "rate" },
          {
            title: "Status",
            dataIndex: "status",
            render: (value: unknown) => {
              const hedgeStatus = asDisplayString(value);
              return <Tag color={hedgeStatus === "open" ? "blue" : "default"}>{hedgeStatus || "—"}</Tag>;
            },
          },
          {
            title: "",
            key: "actions",
            render: (_value, row): ReactNode =>
              !readOnly && canUpdate && row.status === "open" ? (
                <Button size="small" onClick={() => void closeHedge(String(row.id))}>
                  Close
                </Button>
              ) : null,
          },
        ]}
      />
      <Drawer title="Add Hedge" open={open} onClose={() => setOpen(false)} width={420} destroyOnHidden>
        <SchemaForm module="purchase" entity="hedge" mode="create" onSubmit={handleSubmit} />
      </Drawer>
    </Card>
  );
}

interface SubResourceColumn {
  title: string;
  dataIndex: string;
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
}

function PurchaseSubResourceList({
  title,
  entity,
  endpoint,
  rowEndpoint,
  addPermission,
  editPermission,
  deletePermission,
  readOnly,
  editDeleteReadOnly,
  rowLocked,
  rows,
  onAdded,
  onChanged,
  columns,
  footer,
}: {
  title: string;
  entity: string;
  endpoint: string;
  /** Required together with onEdit/onDelete opting in below - the PATCH/DELETE target for a specific row. */
  rowEndpoint?: (rowId: string) => string;
  addPermission: string;
  /** Omit to leave this sub-resource add-only (no Edit button rendered). */
  editPermission?: string;
  /** Omit to leave this sub-resource add-only (no Delete button rendered). */
  deletePermission?: string;
  readOnly: boolean;
  /** Gates Edit/Delete separately from Add - defaults to `readOnly` (Allocation's own gating, draft-only, applies to both). LME passes `false` here: its own edit/delete lock is per-row (rowLocked), not tied to the purchase's status at all - matching purchase-lme.service.ts's own "not gated by draft/approved/posted" design. */
  editDeleteReadOnly?: boolean;
  /** Per-row lock reason (shown as a disabled-button tooltip) independent of editDeleteReadOnly - e.g. an LME record already consumed by an item. */
  rowLocked?: (row: Record<string, unknown>) => string | undefined;
  rows: Record<string, unknown>[];
  onAdded: () => void;
  /** Called after a successful edit or delete - defaults to onAdded if omitted (both just mean "refetch the parent purchase"). */
  onChanged?: () => void;
  columns: SubResourceColumn[];
  footer?: ReactNode;
}): ReactElement {
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; row: Record<string, unknown> } | null>(null);
  const { message } = AntApp.useApp();
  const refetch = onChanged ?? onAdded;
  const rowsLocked = editDeleteReadOnly ?? readOnly;

  async function handleCreate(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoint, { method: "POST", body: values });
    void message.success(`${title} added`);
    setDrawer(null);
    onAdded();
  }

  async function handleEdit(rowId: string, values: Record<string, unknown>): Promise<void> {
    if (!rowEndpoint) return;
    await apiFetch(rowEndpoint(rowId), { method: "PATCH", body: values });
    void message.success(`${title} updated`);
    setDrawer(null);
    refetch();
  }

  async function handleDelete(rowId: string): Promise<void> {
    if (!rowEndpoint) return;
    await apiFetch(rowEndpoint(rowId), { method: "DELETE" });
    void message.success(`${title} removed`);
    refetch();
  }

  const actionColumn: SubResourceColumn | null =
    editPermission || deletePermission
      ? {
          title: "",
          dataIndex: "__actions",
          render: (_value, row): ReactNode => {
            const lockReason = rowLocked?.(row);
            const disabled = rowsLocked || Boolean(lockReason);
            return (
              <Space>
                {editPermission && (
                  <Can permission={editPermission}>
                    <Tooltip title={lockReason}>
                      <Button size="small" disabled={disabled} onClick={() => setDrawer({ mode: "edit", row })}>
                        Edit
                      </Button>
                    </Tooltip>
                  </Can>
                )}
                {deletePermission && (
                  <Can permission={deletePermission}>
                    <Tooltip title={lockReason}>
                      <Popconfirm
                        title={`Remove this ${title.toLowerCase()}?`}
                        onConfirm={() => void handleDelete(String(row.id))}
                        disabled={disabled}
                      >
                        <Button size="small" danger disabled={disabled}>
                          Remove
                        </Button>
                      </Popconfirm>
                    </Tooltip>
                  </Can>
                )}
              </Space>
            );
          },
        }
      : null;

  return (
    <Card
      title={title}
      size="small"
      extra={
        !readOnly && (
          <Can permission={addPermission}>
            <Button onClick={() => setDrawer({ mode: "create" })}>Add</Button>
          </Can>
        )
      }
    >
      <Table
        dataSource={rows}
        rowKey="id"
        pagination={false}
        size="small"
        locale={{ emptyText: "None added yet" }}
        columns={[
          ...columns.map((column) => ({
            title: column.title,
            dataIndex: column.dataIndex,
            ...(column.render ? { render: column.render } : {}),
          })),
          ...(actionColumn ? [actionColumn] : []),
        ]}
      />
      {footer}
      <Drawer
        title={drawer?.mode === "edit" ? `Edit ${title}` : `Add ${title}`}
        open={drawer !== null}
        onClose={() => setDrawer(null)}
        width={420}
        destroyOnHidden
      >
        {drawer?.mode === "create" && <SchemaForm module="purchase" entity={entity} mode="create" onSubmit={handleCreate} />}
        {drawer?.mode === "edit" && (
          <SchemaForm
            module="purchase"
            entity={entity}
            mode="edit"
            initialValues={drawer.row}
            onSubmit={(values) => handleEdit(String(drawer.row.id), values)}
          />
        )}
      </Drawer>
    </Card>
  );
}

/** Prompt 21 item 6: purely informational running total - allocation is a soft reservation, never validated client-side against 100%. */
function AllocationTotal({ rows }: { rows: Record<string, unknown>[] }): ReactElement {
  const total = rows.reduce((sum, row) => {
    const pct = typeof row.allocationPct === "string" || typeof row.allocationPct === "number" ? Number(row.allocationPct) : 0;
    return sum + (Number.isFinite(pct) ? pct : 0);
  }, 0);
  return (
    <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
      Allocated: {total}% (soft reservation only - not a hard limit)
    </Typography.Text>
  );
}
