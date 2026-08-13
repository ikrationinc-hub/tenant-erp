import { http, HttpResponse } from "msw";
import {
  fieldDefinitionsResponseSchema,
  paginatedRowsResponseSchema,
  type FieldDefinition,
  type FieldDefinitionsResponse,
} from "@ikration/contracts";
import { endpoints } from "../core/api/endpoints";

const API_BASE = import.meta.env.VITE_WEB_API_BASE_URL;

const HEADER_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "header",
  fields: [
    { fieldKey: "purchaseNumber", label: "Purchase Number", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 0 },
    { fieldKey: "divisionId", label: "Division", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1, optionsSource: "masters:divisions" },
    { fieldKey: "purchaseDate", label: "Purchase Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 2 },
    { fieldKey: "branchId", label: "Branch", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3, optionsSource: "branches" },
    { fieldKey: "buyerId", label: "Buyer", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4, optionsSource: "companies" },
    { fieldKey: "supplierId", label: "Supplier", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 5, optionsSource: "suppliers" },
    {
      fieldKey: "pricingType",
      label: "Pricing Type",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 6,
      optionsSource: {
        type: "enum",
        staticOptions: [
          { label: "LME Purchase", value: "lme" },
          { label: "Fixed Price Purchase", value: "fixed" },
        ],
      },
    },
    { fieldKey: "supplierInvoiceNo", label: "Supplier Invoice No.", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 7 },
    { fieldKey: "supplierReferenceNo", label: "Supplier Reference No.", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 8 },
    { fieldKey: "brokerId", label: "Broker", dataType: "select", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 9, optionsSource: "brokers" },
    { fieldKey: "brokerCommission", label: "Broker Commission", fieldType: "Currency", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 10 },
    { fieldKey: "lotNumber", label: "Shipment Lot Number", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 11 },
    {
      fieldKey: "containerId",
      label: "Container Number",
      fieldType: "Lookup",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 12,
      optionsSource: "masters:containers",
      allowCreate: true,
    },
    { fieldKey: "blNo", label: "Bill of Lading No.", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 13 },
    { fieldKey: "loadingDate", label: "Loading Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 14 },
    { fieldKey: "transportModeId", label: "Through", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 15, optionsSource: "masters:transport-modes" },
    { fieldKey: "vesselId", label: "Vessel Name", dataType: "select", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 16, optionsSource: "masters:vessels" },
    { fieldKey: "voyageNumber", label: "Voyage Number", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 17 },
    { fieldKey: "portOfLoadingId", label: "Port of Loading", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 18, optionsSource: "masters:ports" },
    { fieldKey: "portOfDischargeId", label: "Port of Discharge", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 19, optionsSource: "masters:ports" },
    { fieldKey: "warehouseId", label: "Warehouse", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 20, optionsSource: "masters:warehouses" },
    { fieldKey: "incotermId", label: "Incoterm", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 21, optionsSource: "masters:incoterms" },
    { fieldKey: "invoice", label: "Invoice", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 22 },
    { fieldKey: "billOfLading", label: "Bill of Lading", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 23 },
    { fieldKey: "packingList", label: "Packing List", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 24 },
    { fieldKey: "certificateOfOrigin", label: "Certificate of Origin", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 25 },
    { fieldKey: "otherDocuments", label: "Other Documents", fieldType: "MultiUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 26 },
    { fieldKey: "otherDocuments2", label: "Other Documents 2", fieldType: "MultiUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 27 },
  ],
});

/**
 * Matches the REAL field-engine entry exactly (core/field-engine/
 * defaults.ts, module="purchase" entity="po") - the Tier-2 "Other
 * Charges" proof, FE-3/FE-7's whole point. `id`s here (unlike every other
 * mock fixture in this file) exist specifically so the field-definitions
 * admin screen's mock PATCH handler below can target a row by id, the
 * same way the real GET/PATCH pair does - a real GET response always has
 * one (core/provisioning/seed-field-definitions.ts provisions a row per
 * field from day one).
 */
const COSTS_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "po",
  fields: [
    { id: "fd-po-freight", fieldKey: "freight", label: "Freight", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 0, defaultValue: "0" },
    { id: "fd-po-insurance", fieldKey: "insurance", label: "Insurance", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 1, defaultValue: "0" },
    { id: "fd-po-customs", fieldKey: "customs", label: "Customs", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 2, defaultValue: "0" },
    { id: "fd-po-other-charges", fieldKey: "otherCharges", label: "Other Charges", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 3, defaultValue: "0" },
    { id: "fd-po-other-charges-2", fieldKey: "otherCharges2", label: "Other Charges 2", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 4, defaultValue: "0" },
    { id: "fd-po-other-charges-3", fieldKey: "otherCharges3", label: "Other Charges 3", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 5, defaultValue: "0" },
  ],
});

const ITEM_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "item",
  fields: [
    { fieldKey: "itemId", label: "Item", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0, optionsSource: "masters:items" },
    { fieldKey: "gradeId", label: "Grade", dataType: "select", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 1, optionsSource: "masters:item-grades" },
    { fieldKey: "quantity", label: "Quantity", fieldType: "Decimal", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 2 },
    { fieldKey: "uomId", label: "Unit of Measure", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3, optionsSource: "masters:uom" },
    { fieldKey: "purchaseRateUsd", label: "Purchase Rate (USD)", fieldType: "Currency", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 4 },
    { fieldKey: "exchangeRate", label: "Exchange Rate", fieldType: "Decimal", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 5 },
  ],
});

const ALLOCATION_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "allocation",
  fields: [
    { fieldKey: "reservedCustomerId", label: "Reserved Customer", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0, optionsSource: "masters:customers" },
    { fieldKey: "allocationPct", label: "Allocation %", fieldType: "Percentage", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
  ],
});

const LME_RECORD_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "lme_record",
  fields: [
    { fieldKey: "lmeExchangeId", label: "LME Exchange", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0, optionsSource: "masters:lme-exchanges" },
    { fieldKey: "metal", label: "Metal", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
    {
      fieldKey: "lmeType",
      label: "LME Type",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
      optionsSource: {
        type: "enum",
        staticOptions: [
          { label: "Open", value: "open" },
          { label: "Close", value: "close" },
          { label: "Cash", value: "cash" },
        ],
      },
    },
    { fieldKey: "lmePriceUsd", label: "LME Purchase Price (USD)", fieldType: "Currency", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3 },
    { fieldKey: "fixingDate", label: "LME Fixing Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4 },
    { fieldKey: "agreedPremiumPct", label: "Agreed %", fieldType: "Percentage", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 5 },
  ],
});

const HEDGE_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "hedge",
  fields: [
    { fieldKey: "hedgePlatformId", label: "Hedge Platform", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0, optionsSource: "masters:hedge-platforms" },
    { fieldKey: "contractNumber", label: "Hedge Contract Number", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
    {
      fieldKey: "position",
      label: "Hedge Position",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
      optionsSource: {
        type: "enum",
        staticOptions: [
          { label: "Buy", value: "buy" },
          { label: "Sell", value: "sell" },
        ],
      },
    },
    { fieldKey: "quantity", label: "Hedge Quantity", fieldType: "Decimal", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3 },
    { fieldKey: "rate", label: "Hedge Rate", fieldType: "Currency", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4 },
    { fieldKey: "hedgeDate", label: "Hedge Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 5 },
  ],
});

/** Prompt 22: the supplier invoice - the document that actually moves stock (Part 3), mirroring core/field-engine/defaults.ts's real module="purchase" entity="invoice" entry field-for-field. */
const INVOICE_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "invoice",
  fields: [
    { fieldKey: "invoiceNumber", label: "Invoice Number", fieldType: "AutoGenerated", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 0 },
    { fieldKey: "supplierInvoiceNo", label: "Supplier Invoice No.", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 1 },
    { fieldKey: "invoiceDate", label: "Invoice Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 2 },
    { fieldKey: "invoiceAmountUsd", label: "Invoice Amount (USD)", fieldType: "Currency", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3 },
    { fieldKey: "invoiceFile", label: "Invoice Document", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 4 },
  ],
});

const PURCHASE_FIELD_DEFINITIONS: FieldDefinitionsResponse[] = [
  HEADER_FIELDS,
  COSTS_FIELDS,
  ITEM_FIELDS,
  ALLOCATION_FIELDS,
  LME_RECORD_FIELDS,
  HEDGE_FIELDS,
  INVOICE_FIELDS,
];

export function resolvePurchaseFieldDefinitions(module: string, entity: string): FieldDefinitionsResponse | undefined {
  return PURCHASE_FIELD_DEFINITIONS.find((schema) => schema.module === module && schema.entity === entity);
}

/**
 * Mutates the matching field IN PLACE (not a fresh object) - every
 * PURCHASE_FIELD_DEFINITIONS entry is a shared module-scope const, so the
 * next resolvePurchaseFieldDefinitions() call (a SchemaForm rendering
 * this same module/entity elsewhere) sees the change immediately, same
 * as the real field-engine's cache-bust-on-write behavior. Returns the
 * updated field, or undefined if no field with this id is mocked here.
 */
export function updatePurchaseFieldDefinition(
  id: string,
  patch: { label?: string; isVisible?: boolean; isMandatory?: boolean; sortOrder?: number },
): FieldDefinition | undefined {
  for (const schema of PURCHASE_FIELD_DEFINITIONS) {
    const field = schema.fields?.find((f) => f.id === id);
    if (field) {
      Object.assign(field, patch);
      return field;
    }
  }
  return undefined;
}

interface MockShipment extends Record<string, unknown> {
  lotNumber: string;
}

export interface MockPurchase extends Record<string, unknown> {
  id: string;
  purchaseNumber: string;
  status: "draft" | "approved" | "posted";
  branchId?: unknown;
  shipment: MockShipment;
  items: Record<string, unknown>[];
  allocations: Record<string, unknown>[];
  additionalCosts: Record<string, unknown>;
  lmeRecords: Record<string, unknown>[];
  hedges: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
}

/** Shared with inventory-handlers.ts (Prompt 22): the mock stock ledger is derived from this SAME array's APPROVED INVOICES, not from the purchase's own status - approving a purchase moves nothing (intent only); approving one of its invoices is what shows up in the mock Inventory screen. */
export const purchases: MockPurchase[] = [];
let nextPurchaseSequence = 1;
let nextChildId = 1;
let nextInvoiceSequence = 1;

/** A demo-only string multiply+round - NOT the real money engine (decimal.js against numeric columns, rule 1). This mock simulates what the server would return so the UI has plausible numbers to render; it is never shipped, never real financial data. */
function multiplyDecimalStrings(a: string, b: string, decimals: number): string {
  const product = Number(a || "0") * Number(b || "0");
  return product.toFixed(decimals);
}

/**
 * Mirrors purchase.service.ts's getById: invoice variance (Prompt 22
 * follow-up) AND lme_record isUsed (Prompt 23) are both computed fresh
 * from the purchase's current items at response time, never stored -
 * demo-only arithmetic, same caveat as multiplyDecimalStrings above.
 */
function withComputedFields(purchase: MockPurchase): MockPurchase {
  const purchaseItemsAmount = purchase.items.reduce((sum, item) => {
    const pricing = item.pricing as Record<string, unknown> | undefined;
    const amount = typeof pricing?.purchaseAmountUsd === "string" ? pricing.purchaseAmountUsd : "0";
    return sum + Number(amount);
  }, 0);
  const purchaseItemsAmountUsd = purchaseItemsAmount.toFixed(2);

  const invoices = purchase.invoices.map((invoice) => {
    const invoiceAmount = Number(typeof invoice.invoiceAmountUsd === "string" ? invoice.invoiceAmountUsd : "0");
    const varianceUsd = (invoiceAmount - purchaseItemsAmount).toFixed(2);
    const variancePct = purchaseItemsAmount === 0 ? null : ((invoiceAmount - purchaseItemsAmount) / purchaseItemsAmount * 100).toFixed(2);
    return { ...invoice, purchaseItemsAmountUsd, varianceUsd, variancePct };
  });

  const usedLmeRecordIds = new Set(
    purchase.items
      .map((item) => (item.pricing as Record<string, unknown> | undefined)?.lmeRecordId)
      .filter((id): id is string => typeof id === "string"),
  );
  const lmeRecords = purchase.lmeRecords.map((record) => ({ ...record, isUsed: usedLmeRecordIds.has(String(record.id)) }));

  return { ...purchase, invoices, lmeRecords };
}

function isLmeRecordUsed(purchase: MockPurchase, lmeRecordId: string): boolean {
  return purchase.items.some((item) => (item.pricing as Record<string, unknown> | undefined)?.lmeRecordId === lmeRecordId);
}

function findPurchase(id: string | readonly string[] | undefined): MockPurchase | undefined {
  const purchaseId = typeof id === "string" ? id : "";
  return purchases.find((purchase) => purchase.id === purchaseId);
}

/** A body field off `Record<string, unknown>` could be anything - only ever a safe numeric-string default if it actually is one. */
function asNumericString(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

export const purchaseHandlers = [
  http.get(`${API_BASE}${endpoints.purchases}`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const search = url.searchParams.get("search")?.toLowerCase();
    const status = url.searchParams.get("status");
    const supplierId = url.searchParams.get("supplierId");
    const branchId = url.searchParams.get("branchId");
    const dateFrom = url.searchParams.get("purchaseDateFrom");
    const dateTo = url.searchParams.get("purchaseDateTo");

    let filtered = purchases;
    if (search) {
      filtered = filtered.filter((row) => row.purchaseNumber.toLowerCase().includes(search));
    }
    if (status) {
      filtered = filtered.filter((row) => row.status === status);
    }
    if (supplierId) {
      filtered = filtered.filter((row) => row.supplierId === supplierId);
    }
    if (branchId) {
      filtered = filtered.filter((row) => row.branchId === branchId);
    }
    if (dateFrom) {
      filtered = filtered.filter((row) => typeof row.purchaseDate === "string" && row.purchaseDate >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter((row) => typeof row.purchaseDate === "string" && row.purchaseDate <= dateTo);
    }

    const total = filtered.length;
    const items = filtered
      .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
      .map(({ items: _items, allocations: _allocations, lmeRecords: _lmeRecords, hedges: _hedges, ...summary }) => summary);
    return HttpResponse.json(paginatedRowsResponseSchema.parse({ items, total, page, pageSize }));
  }),

  http.get(`${API_BASE}${endpoints.purchases}/:id`, ({ params }) => {
    const purchase = findPurchase(params.id);
    return purchase ? HttpResponse.json(withComputedFields(purchase)) : new HttpResponse(null, { status: 404 });
  }),

  http.post(`${API_BASE}${endpoints.purchases}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown> & { shipment: MockShipment };
    const { shipment, ...header } = body;
    const purchase: MockPurchase = {
      ...header,
      id: `purchase-${nextPurchaseSequence}`,
      purchaseNumber: `PO-${String(nextPurchaseSequence).padStart(4, "0")}`,
      status: "draft",
      shipment,
      items: [],
      allocations: [],
      additionalCosts: {},
      lmeRecords: [],
      hedges: [],
      invoices: [],
    };
    nextPurchaseSequence += 1;
    purchases.push(purchase);
    return HttpResponse.json(withComputedFields(purchase), { status: 201 });
  }),

  http.patch(`${API_BASE}${endpoints.purchases}/:id`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown> & { shipment?: Partial<MockShipment> };
    const { shipment, ...header } = body;
    Object.assign(purchase, header);
    if (shipment) {
      Object.assign(purchase.shipment, shipment);
    }
    return HttpResponse.json(withComputedFields(purchase));
  }),

  http.patch(`${API_BASE}${endpoints.approvePurchase(":id")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    purchase.status = "approved";
    return HttpResponse.json(withComputedFields(purchase));
  }),

  http.patch(`${API_BASE}${endpoints.postPurchase(":id")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    purchase.status = "posted";
    return HttpResponse.json(withComputedFields(purchase));
  }),

  http.post(`${API_BASE}${endpoints.purchaseItems(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const quantity = asNumericString(body.quantity, "0");
    // Mirrors purchase-items.service.ts's resolveItemRate: under
    // pricing_type "lme" the rate comes from the most recent LME record's
    // final rate, never the client - purchaseRateUsd isn't even accepted
    // in the request in that case (PurchaseDetailScreen hides the field).
    const latestLmeRecord = purchase.lmeRecords[purchase.lmeRecords.length - 1];
    const rate =
      purchase.pricingType === "lme"
        ? asNumericString(latestLmeRecord?.finalPurchaseRateUsd, "0")
        : asNumericString(body.purchaseRateUsd, "0");
    const exchangeRate = asNumericString(body.exchangeRate, "0");
    const purchaseAmountUsd = multiplyDecimalStrings(quantity, rate, 2);
    const purchaseAmountAed = multiplyDecimalStrings(purchaseAmountUsd, exchangeRate, 2);
    nextChildId += 1;
    const item = {
      id: `item-${nextChildId}`,
      itemId: body.itemId,
      gradeId: body.gradeId,
      quantity,
      uomId: body.uomId,
      pricing: {
        purchaseRateUsd: rate,
        purchaseAmountUsd,
        exchangeRate,
        purchaseAmountAed,
        // Mirrors purchase_pricing.lme_record_id (Prompt 23): which LME
        // record this item's rate came from, so an LME record's Edit/Remove
        // can lock once it's been used, same as the real backend.
        ...(purchase.pricingType === "lme" && latestLmeRecord ? { lmeRecordId: latestLmeRecord.id } : {}),
      },
    };
    purchase.items.push(item);
    return HttpResponse.json(item, { status: 201 });
  }),

  http.patch(`${API_BASE}${endpoints.purchaseItem(":id", ":itemId")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    const item = purchase?.items.find((candidate) => candidate.id === params.itemId);
    if (!purchase || !item) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(item, body);
    return HttpResponse.json(item);
  }),

  http.post(`${API_BASE}${endpoints.purchaseAllocations(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    nextChildId += 1;
    const allocation = { id: `allocation-${nextChildId}`, ...body };
    purchase.allocations.push(allocation);
    return HttpResponse.json(allocation, { status: 201 });
  }),

  // Prompt 23: edit/remove - mirrors purchase-allocations.service.ts's own Draft-only gate (rule 8).
  http.patch(`${API_BASE}${endpoints.purchaseAllocation(":id", ":allocationId")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    const allocation = purchase?.allocations.find((row) => row.id === params.allocationId);
    if (!purchase || !allocation) {
      return new HttpResponse(null, { status: 404 });
    }
    if (purchase.status !== "draft") {
      return HttpResponse.json({ error: { code: "CONFLICT", message: "Purchase is not draft and can no longer be edited" } }, { status: 409 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(allocation, body);
    return HttpResponse.json(allocation);
  }),
  http.delete(`${API_BASE}${endpoints.purchaseAllocation(":id", ":allocationId")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    if (purchase.status !== "draft") {
      return HttpResponse.json({ error: { code: "CONFLICT", message: "Purchase is not draft and can no longer be edited" } }, { status: 409 });
    }
    purchase.allocations = purchase.allocations.filter((row) => row.id !== params.allocationId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.patch(`${API_BASE}${endpoints.purchaseCosts(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    purchase.additionalCosts = { ...purchase.additionalCosts, ...body };
    return HttpResponse.json(purchase.additionalCosts);
  }),

  http.post(`${API_BASE}${endpoints.purchaseLmeRecords(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const lmePriceUsd = asNumericString(body.lmePriceUsd, "0");
    const agreedPremiumPct = asNumericString(body.agreedPremiumPct, "0");
    // Mirrors the real formula (purchase-lme.service.ts): a DIRECT
    // multiplier of the LME price, not a markup added on top.
    const finalPurchaseRateUsd = (Number(lmePriceUsd) * (Number(agreedPremiumPct) / 100)).toFixed(6);
    nextChildId += 1;
    const record = { id: `lme-${nextChildId}`, ...body, lmePriceUsd, agreedPremiumPct, finalPurchaseRateUsd };
    purchase.lmeRecords.push(record);
    return HttpResponse.json(record, { status: 201 });
  }),

  // Prompt 23: edit/remove - mirrors purchase-lme.service.ts's own "locked once used by an item" gate, not the purchase's own status.
  http.patch(`${API_BASE}${endpoints.purchaseLmeRecord(":id", ":lmeRecordId")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    const record = purchase?.lmeRecords.find((row) => row.id === params.lmeRecordId);
    if (!purchase || !record) {
      return new HttpResponse(null, { status: 404 });
    }
    if (isLmeRecordUsed(purchase, String(record.id))) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "This LME record has already been used to price an item and can no longer be edited or removed" } },
        { status: 409 },
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    const lmePriceUsd = asNumericString(body.lmePriceUsd, "0");
    const agreedPremiumPct = asNumericString(body.agreedPremiumPct, "0");
    const finalPurchaseRateUsd = (Number(lmePriceUsd) * (Number(agreedPremiumPct) / 100)).toFixed(6);
    Object.assign(record, body, { lmePriceUsd, agreedPremiumPct, finalPurchaseRateUsd });
    return HttpResponse.json(record);
  }),
  http.delete(`${API_BASE}${endpoints.purchaseLmeRecord(":id", ":lmeRecordId")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    if (isLmeRecordUsed(purchase, String(params.lmeRecordId))) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "This LME record has already been used to price an item and can no longer be edited or removed" } },
        { status: 409 },
      );
    }
    purchase.lmeRecords = purchase.lmeRecords.filter((row) => row.id !== params.lmeRecordId);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(`${API_BASE}${endpoints.purchaseHedges(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    nextChildId += 1;
    const hedge = { id: `hedge-${nextChildId}`, ...body, status: "open" };
    purchase.hedges.push(hedge);
    return HttpResponse.json(hedge, { status: 201 });
  }),

  http.patch(`${API_BASE}${endpoints.purchaseHedge(":id", ":hedgeId")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    const hedge = purchase?.hedges.find((candidate) => candidate.id === params.hedgeId);
    if (!purchase || !hedge) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(hedge, body);
    return HttpResponse.json(hedge);
  }),

  // Prompt 22: the supplier invoice - own lifecycle, own number series (mocked as SINV-{seq}), own approve endpoint that's the ONLY thing that ever pushes into purchase.invoices with status "approved" (inventory-handlers.ts's computeMovements reads exactly that).
  http.post(`${API_BASE}${endpoints.purchaseInvoices(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    if (purchase.invoices.length > 0) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "This purchase already has an invoice - partial invoicing is not enabled" } },
        { status: 409 },
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    nextInvoiceSequence += 1;
    const invoice = { id: `invoice-${nextInvoiceSequence}`, invoiceNumber: `SINV-2024-${String(nextInvoiceSequence).padStart(4, "0")}`, ...body, status: "draft" };
    purchase.invoices.push(invoice);
    return HttpResponse.json(invoice, { status: 201 });
  }),

  http.patch(`${API_BASE}${endpoints.purchaseInvoice(":id", ":invoiceId")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    const invoice = purchase?.invoices.find((candidate) => candidate.id === params.invoiceId);
    if (!purchase || !invoice) {
      return new HttpResponse(null, { status: 404 });
    }
    if (invoice.status !== "draft") {
      return HttpResponse.json({ error: { code: "CONFLICT", message: "This invoice is no longer editable" } }, { status: 409 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(invoice, body);
    return HttpResponse.json(invoice);
  }),

  http.patch(`${API_BASE}${endpoints.approvePurchaseInvoice(":id", ":invoiceId")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    const invoice = purchase?.invoices.find((candidate) => candidate.id === params.invoiceId);
    if (!purchase || !invoice) {
      return new HttpResponse(null, { status: 404 });
    }
    if (purchase.status === "draft") {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: "Cannot approve: the underlying purchase order must be approved first" } },
        { status: 409 },
      );
    }
    invoice.status = "approved";
    return HttpResponse.json(invoice);
  }),

  http.patch(`${API_BASE}${endpoints.fieldDefinition(":id")}`, async ({ params, request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const body = (await request.json()) as Record<string, unknown>;
    const updated = updatePurchaseFieldDefinition(id, body);
    if (!updated) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(updated);
  }),
];
