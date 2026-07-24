import { http, HttpResponse } from "msw";
import {
  fieldDefinitionsResponseSchema,
  masterOptionsResponseSchema,
  paginatedRowsResponseSchema,
  type FieldDefinitionsResponse,
} from "@hyperion/contracts";
import { endpoints } from "../core/api/endpoints";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

const HEADER_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "header",
  fields: [
    { fieldKey: "purchaseNumber", label: "Purchase Number", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 0 },
    { fieldKey: "purchaseDate", label: "Purchase Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 1 },
    { fieldKey: "branchId", label: "Branch", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 2, optionsSource: "branches" },
    { fieldKey: "buyerId", label: "Buyer", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3, optionsSource: "users" },
    { fieldKey: "supplierId", label: "Supplier", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4, optionsSource: "suppliers" },
    { fieldKey: "supplierInvoiceNo", label: "Supplier Invoice No.", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 5 },
    { fieldKey: "supplierReferenceNo", label: "Supplier Reference No.", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 6 },
    { fieldKey: "lotNumber", label: "Shipment Lot Number", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 7 },
    { fieldKey: "containerNumber", label: "Container Number", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 8 },
    { fieldKey: "blNo", label: "Bill of Lading No.", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 9 },
    { fieldKey: "loadingDate", label: "Loading Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 10 },
    { fieldKey: "transportModeId", label: "Through", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 11, optionsSource: "masters:transport-modes" },
    { fieldKey: "vesselId", label: "Vessel Name", dataType: "select", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 12, optionsSource: "masters:vessels" },
    { fieldKey: "voyageNumber", label: "Voyage Number", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 13 },
    { fieldKey: "portOfLoadingId", label: "Port of Loading", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 14, optionsSource: "masters:ports" },
    { fieldKey: "portOfDischargeId", label: "Port of Discharge", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 15, optionsSource: "masters:ports" },
    { fieldKey: "warehouseId", label: "Warehouse", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 16, optionsSource: "masters:warehouses" },
    { fieldKey: "incotermId", label: "Incoterm", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 17, optionsSource: "masters:incoterms" },
    { fieldKey: "invoice", label: "Invoice", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 18 },
    { fieldKey: "billOfLading", label: "Bill of Lading", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 19 },
    { fieldKey: "packingList", label: "Packing List", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 20 },
    { fieldKey: "certificateOfOrigin", label: "Certificate of Origin", fieldType: "FileUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 21 },
    { fieldKey: "otherDocuments", label: "Other Documents", fieldType: "MultiUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 22 },
    { fieldKey: "otherDocuments2", label: "Other Documents 2", fieldType: "MultiUpload", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 23 },
  ],
});

/** Matches the REAL field-engine entry exactly (core/field-engine/defaults.ts, module="purchase" entity="po") - the Tier-2 "Other Charges" proof, FE-3/FE-7's whole point. */
const COSTS_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "po",
  fields: [
    { fieldKey: "freight", label: "Freight", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 0, defaultValue: "0" },
    { fieldKey: "insurance", label: "Insurance", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 1, defaultValue: "0" },
    { fieldKey: "customs", label: "Customs", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 2, defaultValue: "0" },
    { fieldKey: "otherCharges", label: "Other Charges", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 3, defaultValue: "0" },
    { fieldKey: "otherCharges2", label: "Other Charges 2", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 4, defaultValue: "0" },
    { fieldKey: "otherCharges3", label: "Other Charges 3", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 5, defaultValue: "0" },
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
    { fieldKey: "reservedCustomerId", label: "Reserved Customer", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0, optionsSource: "customers" },
    { fieldKey: "allocationPct", label: "Allocation %", fieldType: "Percentage", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
  ],
});

const LME_RECORD_FIELDS = fieldDefinitionsResponseSchema.parse({
  module: "purchase",
  entity: "lme_record",
  fields: [
    { fieldKey: "lmeExchangeId", label: "LME Exchange", dataType: "select", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0, optionsSource: "masters:lme-exchanges" },
    { fieldKey: "metal", label: "Metal", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
    { fieldKey: "lmePriceUsd", label: "LME Purchase Price (USD)", fieldType: "Currency", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 2 },
    { fieldKey: "fixingDate", label: "LME Fixing Date", dataType: "date", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 3 },
    { fieldKey: "agreedPremiumPct", label: "Agreed Premium (%)", fieldType: "Percentage", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 4 },
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

const PURCHASE_FIELD_DEFINITIONS: FieldDefinitionsResponse[] = [
  HEADER_FIELDS,
  COSTS_FIELDS,
  ITEM_FIELDS,
  ALLOCATION_FIELDS,
  LME_RECORD_FIELDS,
  HEDGE_FIELDS,
];

export function resolvePurchaseFieldDefinitions(module: string, entity: string): FieldDefinitionsResponse | undefined {
  return PURCHASE_FIELD_DEFINITIONS.find((schema) => schema.module === module && schema.entity === entity);
}

const CUSTOMER_OPTIONS = [
  { value: "cust-1", label: "Copperline Industries" },
  { value: "cust-2", label: "Northgate Metals" },
];

interface MockShipment extends Record<string, unknown> {
  lotNumber: string;
}

interface MockPurchase extends Record<string, unknown> {
  id: string;
  purchaseNumber: string;
  status: "draft" | "approved" | "posted";
  shipment: MockShipment;
  items: Record<string, unknown>[];
  allocations: Record<string, unknown>[];
  additionalCosts: Record<string, unknown>;
  lmeRecords: Record<string, unknown>[];
  hedges: Record<string, unknown>[];
}

const purchases: MockPurchase[] = [];
let nextPurchaseSequence = 1;
let nextChildId = 1;

/** A demo-only string multiply+round - NOT the real money engine (decimal.js against numeric columns, rule 1). This mock simulates what the server would return so the UI has plausible numbers to render; it is never shipped, never real financial data. */
function multiplyDecimalStrings(a: string, b: string, decimals: number): string {
  const product = Number(a || "0") * Number(b || "0");
  return product.toFixed(decimals);
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
  http.get(`${API_BASE}${endpoints.customerOptions}`, () =>
    HttpResponse.json(masterOptionsResponseSchema.parse({ options: CUSTOMER_OPTIONS })),
  ),

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
    return purchase ? HttpResponse.json(purchase) : new HttpResponse(null, { status: 404 });
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
    };
    nextPurchaseSequence += 1;
    purchases.push(purchase);
    return HttpResponse.json(purchase, { status: 201 });
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
    return HttpResponse.json(purchase);
  }),

  http.patch(`${API_BASE}${endpoints.approvePurchase(":id")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    purchase.status = "approved";
    return HttpResponse.json(purchase);
  }),

  http.patch(`${API_BASE}${endpoints.postPurchase(":id")}`, ({ params }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    purchase.status = "posted";
    return HttpResponse.json(purchase);
  }),

  http.post(`${API_BASE}${endpoints.purchaseItems(":id")}`, async ({ params, request }) => {
    const purchase = findPurchase(params.id);
    if (!purchase) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const quantity = asNumericString(body.quantity, "0");
    const rate = asNumericString(body.purchaseRateUsd, "0");
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
      pricing: { purchaseRateUsd: rate, purchaseAmountUsd, exchangeRate, purchaseAmountAed },
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
    const finalPurchaseRateUsd = (Number(lmePriceUsd) * (1 + Number(agreedPremiumPct) / 100)).toFixed(6);
    nextChildId += 1;
    const record = { id: `lme-${nextChildId}`, ...body, lmePriceUsd, agreedPremiumPct, finalPurchaseRateUsd };
    purchase.lmeRecords.push(record);
    return HttpResponse.json(record, { status: 201 });
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
];
