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

// --- C-3b (docs/CONTRACT-MODULE-BUILD.md): the full document + assembly ----
// mock - matches the real API's own wire shape closely enough for the
// dev-mode screens (ContractsListScreen/ContractDetailScreen/
// ClauseLibraryScreen/ContractTemplatesScreen) to actually work end to end
// against MSW, not just against the real backend.

interface MockClause {
  id: string;
  clauseCode: string;
  clauseTitle: string;
  category: "general_tc" | "division_specific";
  divisionId: string | null;
  isActive: boolean;
}
interface MockClauseVersion {
  id: string;
  clauseId: string;
  versionNumber: number;
  clauseText: string;
  status: "draft" | "approved" | "active" | "superseded" | "expired";
  effectiveFrom: string;
}
interface MockContractClause {
  id: string;
  clauseId: string;
  clauseVersionId: string;
  resolvedText: string;
  sortOrder: number;
  isMandatory: boolean;
  isEdited: boolean;
  isFromRule: boolean;
}
interface MockContract {
  id: string;
  contractNumber: string;
  contractDate: string;
  status: "draft" | "approved" | "signed" | "closed";
  divisionId: string | null;
  templateId: string | null;
  materialType: string | null;
  weightKg: string | null;
  rateUsd: string | null;
  deliveryTerms: string | null;
  clauses: MockContractClause[];
  parties: unknown[];
  linkedSource: unknown;
}
interface MockTemplateClause {
  id: string;
  clauseId: string;
  clauseTitle: string;
  clauseCode: string;
  isMandatory: boolean;
  sortOrder: number;
}
interface MockTemplate {
  id: string;
  name: string;
  contractType: string;
  divisionId: string | null;
  isActive: boolean;
  templateClauses: MockTemplateClause[];
}

let nextContractSeq = 1;
const clausesById = new Map<string, MockClause>();
const versionsByClauseId = new Map<string, MockClauseVersion[]>();
const contractsById = new Map<string, MockContract>();
const templatesById = new Map<string, MockTemplate>();

function activeVersionFor(clauseId: string): MockClauseVersion | undefined {
  return versionsByClauseId.get(clauseId)?.find((v) => v.status === "active");
}

export const contractHandlers = [
  // --- Clause library --------------------------------------------------------
  http.get(`${API_BASE}${endpoints.clauses}`, ({ request }) => {
    const url = new URL(request.url);
    const divisionId = url.searchParams.get("divisionId");
    const items = [...clausesById.values()].filter((c) => !divisionId || c.divisionId === divisionId || c.divisionId === null);
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 200 });
  }),
  http.post(`${API_BASE}${endpoints.clauses}`, async ({ request }) => {
    const body = (await request.json()) as { clauseTitle: string; category: "general_tc" | "division_specific"; divisionId?: string; clauseText: string; effectiveFrom: string; changeReason: string };
    const clauseId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    clausesById.set(clauseId, {
      id: clauseId,
      clauseCode: `CL-${String(clausesById.size + 1).padStart(4, "0")}`,
      clauseTitle: body.clauseTitle,
      category: body.category,
      divisionId: body.divisionId ?? null,
      isActive: true,
    });
    versionsByClauseId.set(clauseId, [{ id: versionId, clauseId, versionNumber: 1, clauseText: body.clauseText, status: "active", effectiveFrom: body.effectiveFrom }]);
    return HttpResponse.json({ clause: clausesById.get(clauseId), version: versionsByClauseId.get(clauseId)?.[0] }, { status: 201 });
  }),
  http.get(`${API_BASE}/clauses/:clauseId/versions`, ({ params }) => {
    const clauseId = typeof params.clauseId === "string" ? params.clauseId : "";
    return HttpResponse.json({ items: versionsByClauseId.get(clauseId) ?? [] });
  }),
  http.post(`${API_BASE}/clauses/:clauseId/versions`, async ({ params, request }) => {
    const clauseId = typeof params.clauseId === "string" ? params.clauseId : "";
    const body = (await request.json()) as { clauseText: string; effectiveFrom: string; changeReason: string };
    const versions = versionsByClauseId.get(clauseId) ?? [];
    const version: MockClauseVersion = { id: crypto.randomUUID(), clauseId, versionNumber: versions.length + 1, clauseText: body.clauseText, status: "draft", effectiveFrom: body.effectiveFrom };
    versionsByClauseId.set(clauseId, [...versions, version]);
    return HttpResponse.json(version, { status: 201 });
  }),
  http.patch(`${API_BASE}/clauses/:clauseId/versions/:versionId/approve`, ({ params }) => {
    const clauseId = typeof params.clauseId === "string" ? params.clauseId : "";
    const versionId = typeof params.versionId === "string" ? params.versionId : "";
    const versions = versionsByClauseId.get(clauseId) ?? [];
    const updated = versions.map((v) => {
      if (v.id === versionId) return { ...v, status: "active" as const };
      if (v.status === "active") return { ...v, status: "superseded" as const };
      return v;
    });
    versionsByClauseId.set(clauseId, updated);
    return HttpResponse.json(updated.find((v) => v.id === versionId));
  }),

  // --- Contracts ---------------------------------------------------------------
  http.get(`${API_BASE}${endpoints.contracts}`, () => {
    const items = [...contractsById.values()];
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 20 });
  }),
  http.post(`${API_BASE}${endpoints.contracts}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const id = crypto.randomUUID();
    const templateId = typeof body.templateId === "string" ? body.templateId : null;
    const template = templateId ? templatesById.get(templateId) : undefined;
    const contractClauses: MockContractClause[] = (template?.templateClauses ?? []).map((tc, index) => {
      const activeVersion = activeVersionFor(tc.clauseId);
      return {
        id: crypto.randomUUID(),
        clauseId: tc.clauseId,
        clauseVersionId: activeVersion?.id ?? "",
        resolvedText: activeVersion?.clauseText ?? "",
        sortOrder: index,
        isMandatory: tc.isMandatory,
        isEdited: false,
        isFromRule: false,
      };
    });
    const contract: MockContract = {
      id,
      contractNumber: `CTR-2026-${String(nextContractSeq++).padStart(4, "0")}`,
      contractDate: typeof body.contractDate === "string" ? body.contractDate : new Date().toISOString().slice(0, 10),
      status: "draft",
      divisionId: typeof body.divisionId === "string" ? body.divisionId : (template?.divisionId ?? null),
      templateId,
      materialType: typeof body.materialType === "string" ? body.materialType : null,
      weightKg: typeof body.weightKg === "string" ? body.weightKg : null,
      rateUsd: typeof body.rateUsd === "string" ? body.rateUsd : null,
      deliveryTerms: typeof body.deliveryTerms === "string" ? body.deliveryTerms : null,
      clauses: contractClauses,
      parties: [],
      linkedSource: null,
    };
    contractsById.set(id, contract);
    return HttpResponse.json(contract, { status: 201 });
  }),
  http.get(`${API_BASE}${endpoints.contract(":id")}`, ({ params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contract = contractsById.get(id);
    return contract ? HttpResponse.json(contract) : new HttpResponse(null, { status: 404 });
  }),
  http.patch(`${API_BASE}${endpoints.contract(":id")}`, async ({ params, request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contract = contractsById.get(id);
    if (!contract) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    const updated = { ...contract, ...body };
    contractsById.set(id, updated);
    return HttpResponse.json(updated);
  }),
  ...(["approve", "sign", "close"] as const).map((action) =>
    http.patch(`${API_BASE}${endpoints.contract(":id")}/${action}`, ({ params }) => {
      const id = typeof params.id === "string" ? params.id : "";
      const contract = contractsById.get(id);
      if (!contract) return new HttpResponse(null, { status: 404 });
      const nextStatus = action === "approve" ? "approved" : action === "sign" ? "signed" : "closed";
      const updated: MockContract = { ...contract, status: nextStatus };
      contractsById.set(id, updated);
      return HttpResponse.json(updated);
    }),
  ),

  // --- Assembly ------------------------------------------------------------
  http.post(`${API_BASE}${endpoints.contract(":id")}/clauses`, async ({ params, request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contract = contractsById.get(id);
    if (!contract) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as { clauseId: string };
    const activeVersion = activeVersionFor(body.clauseId);
    const row: MockContractClause = {
      id: crypto.randomUUID(),
      clauseId: body.clauseId,
      clauseVersionId: activeVersion?.id ?? "",
      resolvedText: activeVersion?.clauseText ?? "",
      sortOrder: contract.clauses.length,
      isMandatory: false,
      isEdited: false,
      isFromRule: false,
    };
    contractsById.set(id, { ...contract, clauses: [...contract.clauses, row] });
    return HttpResponse.json(row, { status: 201 });
  }),
  http.delete(`${API_BASE}${endpoints.contract(":id")}/clauses/:contractClauseId`, ({ params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contractClauseId = typeof params.contractClauseId === "string" ? params.contractClauseId : "";
    const contract = contractsById.get(id);
    if (!contract) return new HttpResponse(null, { status: 404 });
    const target = contract.clauses.find((c) => c.id === contractClauseId);
    if (target?.isMandatory) {
      return HttpResponse.json({ error: { code: "CONFLICT", message: "This clause is mandatory and cannot be removed" } }, { status: 409 });
    }
    contractsById.set(id, { ...contract, clauses: contract.clauses.filter((c) => c.id !== contractClauseId) });
    return new HttpResponse(null, { status: 204 });
  }),
  http.patch(`${API_BASE}${endpoints.contract(":id")}/clauses/reorder`, async ({ params, request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contract = contractsById.get(id);
    if (!contract) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as { contractClauseIds: string[] };
    const byId = new Map(contract.clauses.map((c) => [c.id, c]));
    const reordered = body.contractClauseIds
      .map((cid, index) => {
        const clause = byId.get(cid);
        return clause ? { ...clause, sortOrder: index } : undefined;
      })
      .filter((c): c is MockContractClause => c !== undefined);
    contractsById.set(id, { ...contract, clauses: reordered });
    return HttpResponse.json({ items: reordered });
  }),
  http.patch(`${API_BASE}${endpoints.contract(":id")}/clauses/:contractClauseId`, async ({ params, request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contractClauseId = typeof params.contractClauseId === "string" ? params.contractClauseId : "";
    const contract = contractsById.get(id);
    if (!contract) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as { resolvedText: string };
    const updatedClauses = contract.clauses.map((c) => (c.id === contractClauseId ? { ...c, resolvedText: body.resolvedText, isEdited: true } : c));
    contractsById.set(id, { ...contract, clauses: updatedClauses });
    return HttpResponse.json(updatedClauses.find((c) => c.id === contractClauseId));
  }),
  http.get(`${API_BASE}${endpoints.contract(":id")}/preview`, ({ params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const contract = contractsById.get(id);
    if (!contract) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      clauses: contract.clauses.map((c) => ({ contractClauseId: c.id, clauseTitle: clausesById.get(c.clauseId)?.clauseTitle ?? c.clauseId, resolvedText: c.resolvedText })),
    });
  }),

  // --- Templates ---------------------------------------------------------------
  http.get(`${API_BASE}${endpoints.contractTemplates}`, () => {
    const items = [...templatesById.values()];
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 200 });
  }),
  http.post(`${API_BASE}${endpoints.contractTemplates}`, async ({ request }) => {
    const body = (await request.json()) as { name: string; contractType: string; divisionId?: string };
    const id = crypto.randomUUID();
    const template: MockTemplate = { id, name: body.name, contractType: body.contractType, divisionId: body.divisionId ?? null, isActive: true, templateClauses: [] };
    templatesById.set(id, template);
    return HttpResponse.json(template, { status: 201 });
  }),
  http.get(`${API_BASE}${endpoints.contractTemplate(":id")}`, ({ params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const template = templatesById.get(id);
    return template ? HttpResponse.json(template) : new HttpResponse(null, { status: 404 });
  }),
  http.post(`${API_BASE}${endpoints.contractTemplate(":id")}/clauses`, async ({ params, request }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const template = templatesById.get(id);
    if (!template) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as { clauseId: string; isMandatory?: boolean };
    const clause = clausesById.get(body.clauseId);
    const row: MockTemplateClause = { id: crypto.randomUUID(), clauseId: body.clauseId, clauseTitle: clause?.clauseTitle ?? body.clauseId, clauseCode: clause?.clauseCode ?? "", isMandatory: body.isMandatory ?? false, sortOrder: template.templateClauses.length };
    templatesById.set(id, { ...template, templateClauses: [...template.templateClauses, row] });
    return HttpResponse.json({ items: [...template.templateClauses, row] }, { status: 201 });
  }),
  http.delete(`${API_BASE}${endpoints.contractTemplate(":id")}/clauses/:clauseId`, ({ params }) => {
    const id = typeof params.id === "string" ? params.id : "";
    const clauseId = typeof params.clauseId === "string" ? params.clauseId : "";
    const template = templatesById.get(id);
    if (!template) return new HttpResponse(null, { status: 404 });
    const items = template.templateClauses.filter((c) => c.clauseId !== clauseId);
    templatesById.set(id, { ...template, templateClauses: items });
    return HttpResponse.json({ items });
  }),

  // --- Generation (mocked as instantly complete - no real BullMQ/S3 in dev mode) ---
  http.post(`${API_BASE}${endpoints.contract(":id")}/generate`, () => HttpResponse.json({ jobId: "mock-job-1" }, { status: 202 })),
  http.get(`${API_BASE}${endpoints.contract(":id")}/generate/:jobId`, () =>
    HttpResponse.json({ jobId: "mock-job-1", state: "completed", downloadUrls: { docx: "#", pdf: "#" } }),
  ),
];
