import { http, HttpResponse } from "msw";
import {
  fieldDefinitionsResponseSchema,
  masterOptionsResponseSchema,
  type FieldDefinitionsResponse,
} from "@ikration/contracts";
import { endpoints } from "../core/api/endpoints";
import { listHandler, updateHandler, type MockRow } from "./admin-handlers";

const API_BASE = import.meta.env.VITE_WEB_API_BASE_URL;

/** Mirrors customers.validator.ts's createCustomerSchema/updateCustomerSchema field-for-field (S-1, docs/SALES-MODULE-PLAN.md) - exact mirror of suppliers-handlers.ts's supplierFieldDefinitions, plus creditLimit/salespersonUserId. */
export const customerFieldDefinitions: FieldDefinitionsResponse = fieldDefinitionsResponseSchema.parse({
  module: "customers",
  entity: "customer",
  fields: [
    { fieldKey: "code", label: "Customer Code", dataType: "text", isMandatory: false, isEditable: false, isSystem: true, sortOrder: 0 },
    { fieldKey: "name", label: "Customer Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 1 },
    {
      fieldKey: "customerTypeId",
      label: "Customer Type",
      dataType: "select",
      isMandatory: true,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
      optionsSource: "masters:customer-types",
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
      fieldKey: "vatTrn",
      label: "VAT / TRN",
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
    { fieldKey: "creditLimit", label: "Credit Limit", dataType: "decimal", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 9 },
    {
      fieldKey: "salespersonUserId",
      label: "Salesperson",
      dataType: "select",
      isMandatory: false,
      isEditable: true,
      isSystem: false,
      sortOrder: 10,
      optionsSource: "users",
    },
    { fieldKey: "remarks", label: "Remarks", dataType: "textarea", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 11 },
  ],
});

export function resolveCustomerFieldDefinitions(module: string, entity: string): FieldDefinitionsResponse | undefined {
  return module === customerFieldDefinitions.module && entity === customerFieldDefinitions.entity
    ? customerFieldDefinitions
    : undefined;
}

const customers: MockRow[] = [
  {
    id: "cust-1",
    code: "CUS-0001",
    name: "Northgate Metals",
    customerTypeId: "type-export",
    countryId: "in",
    cityId: "mumbai",
    address: "Andheri East",
    vatTrn: "",
    paymentTermId: "term-30-days",
    currencyId: "usd",
    creditLimit: "500000.00",
    salespersonUserId: "",
    remarks: "",
    status: "active",
    contacts: [{ contactPerson: "Priya Shah", mobile: "+919820000010", email: "priya@northgate.test" }],
    banks: [{ details: "HDFC Bank - IBAN IN000000000000000000" }],
  },
  {
    id: "cust-2",
    code: "CUS-0002",
    name: "Gulf Traders",
    customerTypeId: "type-local",
    countryId: "ae",
    cityId: "dubai",
    address: "Al Quoz",
    vatTrn: "TRN-7712",
    paymentTermId: "term-advance",
    currencyId: "aed",
    creditLimit: "200000.00",
    salespersonUserId: "",
    remarks: "",
    status: "active",
    contacts: [],
    banks: [],
  },
];

let nextCustomerId = 1000;

export const customersHandlers = [
  http.get(`${API_BASE}${endpoints.customers}`, listHandler(customers)),
  http.get(`${API_BASE}${endpoints.customerOptions}`, () =>
    HttpResponse.json(
      masterOptionsResponseSchema.parse({
        options: customers
          .filter((row) => row.status === "active")
          .map((row) => ({ value: row.id, label: String(row.name) })),
      }),
    ),
  ),
  // Deliberate mirror of core/masters/registry.ts's re-pointed exception -
  // ContractPartiesForm.tsx/ContractsListScreen.tsx/PurchaseDetailScreen.tsx
  // still call GET /masters/customers/options, so the mock must serve that
  // same URL too, not just /customers/options.
  http.get(`${API_BASE}${endpoints.masterOptions("customers")}`, () =>
    HttpResponse.json(
      masterOptionsResponseSchema.parse({
        options: customers
          .filter((row) => row.status === "active")
          .map((row) => ({ value: row.id, label: String(row.name) })),
      }),
    ),
  ),
  http.get(`${API_BASE}${endpoints.customers}/:id`, ({ params }) => {
    const row = customers.find((candidate) => candidate.id === params.id);
    return row ? HttpResponse.json(row) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${API_BASE}${endpoints.customers}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.remarks === "") {
      return HttpResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { issues: [{ path: ["remarks"], message: "Too small: expected string to have >=1 characters" }] } } },
        { status: 422 },
      );
    }
    if (customers.some((row) => row.name === body.name)) {
      return HttpResponse.json(
        { error: { code: "CONFLICT", message: `A customer with the name "${String(body.name)}" already exists` } },
        { status: 409 },
      );
    }
    nextCustomerId += 1;
    const row: MockRow = {
      ...body,
      id: `cust-${nextCustomerId}`,
      code: `CUS-${String(nextCustomerId).padStart(4, "0")}`,
      status: "active",
    };
    customers.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.patch(`${API_BASE}${endpoints.customers}/:id`, updateHandler(customers)),
  http.patch(`${API_BASE}${endpoints.activateCustomer(":id")}`, ({ params }) => {
    const row = customers.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    row.status = "active";
    return HttpResponse.json(row);
  }),
  http.patch(`${API_BASE}${endpoints.deactivateCustomer(":id")}`, ({ params }) => {
    const row = customers.find((candidate) => candidate.id === params.id);
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    row.status = "inactive";
    return HttpResponse.json(row);
  }),
];
