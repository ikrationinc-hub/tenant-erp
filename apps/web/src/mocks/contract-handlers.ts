import { http, HttpResponse } from "msw";
import { fieldDefinitionsResponseSchema, type FieldDefinitionsResponse } from "@ikration/contracts";
import { endpoints } from "../core/api/endpoints";

const API_BASE = import.meta.env.VITE_WEB_API_BASE_URL;

/**
 * C-3a (docs/CONTRACT-MODULE-BUILD.md Part 2): mirrors the real backend's
 * division-scoped merge (core/field-engine/resolve.ts) - ALL_DIVISIONS_
 * FIELDS renders for every division; SCRAP_DIVISION_FIELDS render ONLY
 * when the request's divisionId matches the mock Scrap division's id
 * (seeded generically by masters-handlers.ts's rowsByUrlSegment, id
 * "divisions-3" - the third seedRows() entry for the "divisions" master).
 * Proves, in the mock layer too, that a second division would need only a
 * new entries array here - no new branching logic - matching the real
 * field engine's own data-not-code guarantee.
 */
const SCRAP_MOCK_DIVISION_ID = "divisions-3";

type FieldDefinitionField = NonNullable<FieldDefinitionsResponse["fields"]>[number];

const ALL_DIVISIONS_FIELDS: FieldDefinitionField[] = [];

const SCRAP_DIVISION_FIELDS: FieldDefinitionField[] = [
  { id: "fd-contract-material-type", fieldKey: "materialType", label: "Material Type", dataType: "text", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 0 },
  { id: "fd-contract-weight-kg", fieldKey: "weightKg", label: "Weight (kg)", fieldType: "Decimal", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 1 },
  { id: "fd-contract-rate-usd", fieldKey: "rateUsd", label: "Rate (USD)", fieldType: "Currency", dataType: "decimal", isMandatory: true, isEditable: true, isSystem: false, sortOrder: 2 },
  { id: "fd-contract-delivery-terms", fieldKey: "deliveryTerms", label: "Delivery Terms", dataType: "text", isMandatory: false, isEditable: true, isSystem: false, sortOrder: 3 },
];

export function resolveContractFieldDefinitions(module: string, entity: string, divisionId: string | null): FieldDefinitionsResponse | undefined {
  if (module !== "contract" || entity !== "header") {
    return undefined;
  }
  const fields = divisionId === SCRAP_MOCK_DIVISION_ID ? [...ALL_DIVISIONS_FIELDS, ...SCRAP_DIVISION_FIELDS] : [...ALL_DIVISIONS_FIELDS];
  return fieldDefinitionsResponseSchema.parse({ module, entity, fields });
}

let nextMockContractId = 1;
interface MockContract extends Record<string, unknown> {
  id: string;
  divisionId?: string;
}
const contractsById = new Map<string, MockContract>();

export const contractHandlers = [
  http.post(`${API_BASE}${endpoints.contracts}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const id = `contract-${nextMockContractId++}`;
    const contract: MockContract = { id, ...body };
    contractsById.set(id, contract);
    return HttpResponse.json(contract, { status: 201 });
  }),
  http.get(`${API_BASE}${endpoints.contract(":id")}`, ({ params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contract = contractsById.get(id);
    if (!contract) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(contract);
  }),
];
