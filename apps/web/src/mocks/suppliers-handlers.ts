import { http, HttpResponse } from "msw";
import {
  fieldDefinitionsResponseSchema,
  masterOptionsResponseSchema,
  type FieldDefinitionsResponse,
} from "@hyperion/contracts";
import { endpoints } from "../core/api/endpoints";
import { listHandler, updateHandler, type MockRow } from "./admin-handlers";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/** Mirrors suppliers.validator.ts's createSupplierSchema/updateSupplierSchema field-for-field - 11 of docs/spec/Purchase-V2.md §1's 15 fields (the other 4 - Contact Person/Mobile/Email/Bank Details - are the contacts/banks sub-tables, not field-definitions-driven). No real field-engine entry yet (module="suppliers" isn't in core/field-engine/defaults.ts). */
export const supplierFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "suppliers",
  entity: "supplier",
  fields: [
    { fieldKey: "code", label: "Supplier Code", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 0 },
    { fieldKey: "name", label: "Supplier Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 1 },
    {
      fieldKey: "supplierTypeId",
      label: "Supplier Type",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
      optionsSource: "masters:supplier-types",
    },
    {
      fieldKey: "countryId",
      label: "Country",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 3,
      optionsSource: "masters:countries",
    },
    {
      fieldKey: "cityId",
      label: "City",
      dataType: "select",
      isMandatory: false,
      isEditable: true,
      isSystem: false,
      sortOrder: 4,
      optionsSource: { type: "master", master: "cities", dependsOn: "countryId" },
    },
    { fieldKey: "address", label: "Address", dataType: "textarea", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 5 },
    {
      fieldKey: "taxRegistrationNo",
      label: "Tax Registration No.",
      dataType: "text",
      isMandatory: false,
      isEditable: true,
      isSystem: false,
      sortOrder: 6,
    },
    {
      fieldKey: "paymentTermId",
      label: "Payment Terms",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 7,
      optionsSource: "masters:payment-terms",
    },
    {
      fieldKey: "currencyId",
      label: "Default Currency",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 8,
      optionsSource: "masters:currencies",
    },
    { fieldKey: "remarks", label: "Remarks", dataType: "textarea", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 9 },
  ],
});

export function resolveSupplierFieldDefinitions(module: string, entity: string): FieldDefinitionsResponse | undefined {
  return module === supplierFieldDefinitions.module && entity === supplierFieldDefinitions.entity
    ? supplierFieldDefinitions
    : undefined;
}

const suppliers: MockRow[] = [
  {
    id: "sup-1",
    code: "SUP-0001",
    name: "Metal Traders LLC",
    supplierTypeId: "type-international",
    countryId: "ae",
    cityId: "dubai",
    address: "Jebel Ali Free Zone",
    taxRegistrationNo: "TRN-5551",
    paymentTermId: "term-30-days",
    currencyId: "usd",
    remarks: "",
    status: "active",
    contacts: [{ contactPerson: "Ahmed Khan", mobile: "+971500000010", email: "ahmed@metaltraders.test" }],
    banks: [{ details: "Emirates NBD - IBAN AE000000000000000000" }],
  },
  {
    id: "sup-2",
    code: "SUP-0002",
    name: "Global Copper Co",
    supplierTypeId: "type-local",
    countryId: "sg",
    cityId: "singapore-city",
    address: "Marina Bay",
    taxRegistrationNo: "",
    paymentTermId: "term-advance",
    currencyId: "sgd",
    remarks: "",
    status: "active",
    contacts: [],
    banks: [],
  },
];

let nextSupplierId = 1000;

export const suppliersHandlers = [
  http.get(`${API_BASE}${endpoints.suppliers}`, listHandler(suppliers)),
  http.get(`${API_BASE}${endpoints.supplierOptions}`, () =>
    HttpResponse.json(
      masterOptionsResponseSchema.parse({
        options: suppliers
          .filter((row) => row.status === "active")
          .map((row) => ({ value: row.id, label: String(row.name) })),
      }),
    ),
  ),
  http.get(`${API_BASE}${endpoints.suppliers}/:id`, ({ params }) => {
    const row = suppliers.find((candidate) => candidate.id === params.id);
    return row ? HttpResponse.json(row) : new HttpResponse(null, { status: 404 });
  }),
  // FR-005: duplicate name -> 409, matching suppliers.service.ts's ConflictError, surfaced through the same ApiError/toast pipeline as any other conflict.
  http.post(`${API_BASE}${endpoints.suppliers}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (suppliers.some((row) => row.name === body.name)) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: `A supplier with the name "${String(body.name)}" already exists` } },
        { status: 409 },
      );
    }
    nextSupplierId += 1;
    const row: MockRow = {
      ...body,
      id: `sup-${nextSupplierId}`,
      code: `SUP-${String(nextSupplierId).padStart(4, "0")}`,
      status: "active",
    };
    suppliers.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.patch(`${API_BASE}${endpoints.suppliers}/:id`, updateHandler(suppliers)),
  http.patch(`${API_BASE}${endpoints.activateSupplier(":id")}`, ({ params }) => {
    const row = suppliers.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    row.status = "active";
    return HttpResponse.json(row);
  }),
  http.patch(`${API_BASE}${endpoints.deactivateSupplier(":id")}`, ({ params }) => {
    const row = suppliers.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    row.status = "inactive";
    return HttpResponse.json(row);
  }),
];
