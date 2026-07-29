import type { ReactElement, ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Alert, Button, Card, Drawer, Space, Spin, Table, Tag, Typography } from "antd";
import { listAttachmentsResponseSchema, masterOptionsResponseSchema, type AttachmentRow } from "@ikration/contracts";
import { apiFetch } from "../../core/api/client";
import { endpoints, withQuery } from "../../core/api/endpoints";
import { SchemaForm } from "../../core/schema-form/SchemaForm";
import { Can } from "../../core/permissions/Can";
import { useHasPermission } from "../../core/permissions/use-permissions";
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
  "containerNumber",
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

/** createPurchaseSchema/updatePurchaseSchema are both `.strict()` - purchaseNumber/status are system-controlled, attachments go through their own API, and an empty-string optional (a UUID Dropdown left blank) must be OMITTED, not sent as `""` (`.uuid().optional()` rejects an empty string, unlike undefined). */
function splitHeaderPayload(values: Record<string, unknown>): Record<string, unknown> {
  const header: Record<string, unknown> = {};
  const shipment: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "purchaseNumber" || ATTACHMENT_KEYS.has(key) || value === "") {
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
    void message.success("Purchase approved - stock updated");
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
          {status && <StatusTag status={status} />}
        </Space>
        {mode === "edit" && purchaseId && (
          <Space>
            {status === "draft" && (
              <Can permission="purchase.po.approve">
                <Button onClick={() => void handleApprove()}>Approve</Button>
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
          mode={posted || !canEditHeader ? "view" : mode === "create" ? "create" : "edit"}
          {...(headerInitialValues ? { initialValues: headerInitialValues } : {})}
          onSubmit={handleHeaderSubmit}
          {...(purchaseId ? { uploadContext: { entity: "purchase", entityId: purchaseId } } : {})}
        />
      </Card>

      {mode === "edit" && purchaseId && purchase && (
        <>
          <PurchaseCostsPanel purchaseId={purchaseId} readOnly={posted || !canUpdate} onSaved={refresh} costs={purchase.additionalCosts} />
          <PurchaseItemsPanel purchaseId={purchaseId} readOnly={posted} onAdded={refresh} items={rowsOf(purchase.items)} />
          <PurchaseSubResourceList
            title="Customer Allocation"
            entity="allocation"
            endpoint={endpoints.purchaseAllocations(purchaseId)}
            addPermission="purchase.po.update"
            readOnly={posted}
            rows={rowsOf(purchase.allocations)}
            onAdded={refresh}
            columns={[
              {
                title: "Reserved Customer",
                dataIndex: "reservedCustomerId",
                render: (value) => resolvedLabel(customerLabels, value),
              },
              { title: "Allocation %", dataIndex: "allocationPct" },
            ]}
          />
          <PurchaseSubResourceList
            title="LME Records"
            entity="lme_record"
            endpoint={endpoints.purchaseLmeRecords(purchaseId)}
            addPermission="purchase.po.create"
            readOnly={posted}
            rows={rowsOf(purchase.lmeRecords)}
            onAdded={refresh}
            columns={[
              { title: "Metal", dataIndex: "metal" },
              { title: "LME Price (USD)", dataIndex: "lmePriceUsd" },
              { title: "Fixing Date", dataIndex: "fixingDate" },
              { title: "Premium %", dataIndex: "agreedPremiumPct" },
              { title: "Final Rate (USD)", dataIndex: "finalPurchaseRateUsd" },
            ]}
          />
          <PurchaseHedgesPanel purchaseId={purchaseId} readOnly={posted} onAdded={refresh} hedges={rowsOf(purchase.hedges)} />
        </>
      )}
    </Space>
  );
}

function StatusTag({ status }: { status: string }): ReactElement {
  const color = status === "posted" ? "green" : status === "approved" ? "blue" : "default";
  return <Tag color={color}>{status.charAt(0).toUpperCase() + status.slice(1)}</Tag>;
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
}: {
  purchaseId: string;
  readOnly: boolean;
  onAdded: () => void;
  items: Record<string, unknown>[];
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
        <SchemaForm module="purchase" entity="item" mode="create" onSubmit={handleSubmit} />
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
  addPermission,
  readOnly,
  rows,
  onAdded,
  columns,
}: {
  title: string;
  entity: string;
  endpoint: string;
  addPermission: string;
  readOnly: boolean;
  rows: Record<string, unknown>[];
  onAdded: () => void;
  columns: SubResourceColumn[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const { message } = AntApp.useApp();

  async function handleSubmit(values: Record<string, unknown>): Promise<void> {
    await apiFetch(endpoint, { method: "POST", body: values });
    void message.success(`${title} added`);
    setOpen(false);
    onAdded();
  }

  return (
    <Card
      title={title}
      size="small"
      extra={
        !readOnly && (
          <Can permission={addPermission}>
            <Button onClick={() => setOpen(true)}>Add</Button>
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
        columns={columns.map((column) => ({
          title: column.title,
          dataIndex: column.dataIndex,
          ...(column.render ? { render: column.render } : {}),
        }))}
      />
      <Drawer title={`Add ${title}`} open={open} onClose={() => setOpen(false)} width={420} destroyOnHidden>
        <SchemaForm module="purchase" entity={entity} mode="create" onSubmit={handleSubmit} />
      </Drawer>
    </Card>
  );
}
