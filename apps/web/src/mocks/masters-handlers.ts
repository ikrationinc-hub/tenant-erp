import { http, HttpResponse } from "msw";
import {
  fieldDefinitionsResponseSchema,
  paginatedRowsResponseSchema,
  type FieldDefinitionsResponse,
} from "@hyperion/contracts";
import { MASTER_REGISTRY } from "../modules/masters/master-registry";

const API_BASE = import.meta.env.VITE_API_BASE_URL;

interface MockMasterRow extends Record<string, unknown> {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

function seedRows(urlSegment: string, label: string): MockMasterRow[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `${urlSegment}-${index + 1}`,
    code: `${urlSegment.toUpperCase().replace(/-/g, "_")}-${index + 1}`,
    name: `${label} ${index + 1}`,
    isActive: true,
    sortOrder: index,
    ...(urlSegment === "cities" ? { countryId: "countries-1" } : {}),
  }));
}

/** One in-memory row set per master, seeded once at module load - mutated by the POST/PATCH handlers below so create/edit/activate/deactivate genuinely round-trip through a "server" (backend rule 10: never faked purely client-side). */
const rowsByUrlSegment = new Map<string, MockMasterRow[]>(
  MASTER_REGISTRY.map((master) => [master.urlSegment, seedRows(master.urlSegment, master.label)]),
);

let nextMockId = 1000;

/**
 * Mirrors core/masters/factory.ts's buildFieldDefaults: every master gets
 * code/name/isActive; cities additionally gets a countryId select (the ONE
 * real example of a master with an extra field). Untyped as
 * FieldDefinition[] deliberately - that's the POST-transform type
 * (optionsSourceSchema's `.transform()` always normalizes to the rich
 * object), but the real backend's wire format is the bare
 * "masters:countries" string this mock is reproducing; parse() below does
 * the same normalization a real response goes through.
 */
function fieldDefinitionsForMaster(entity: string): FieldDefinitionsResponse {
  const fields = [
    { fieldKey: "code", label: "Code", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 0 },
    { fieldKey: "name", label: "Name", dataType: "text", isMandatory: true, isEditable: true, isSystem: true, sortOrder: 1 },
    {
      fieldKey: "isActive",
      label: "Active",
      dataType: "boolean",
      isMandatory: false,
      isEditable: true,
      isSystem: false,
      sortOrder: 2,
    },
    ...(entity === "city"
      ? [
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
        ]
      : []),
  ];
  return fieldDefinitionsResponseSchema.parse({ module: "masters", entity, fields });
}

/** Consulted by handlers.ts's generic field-definitions dispatcher for module === "masters". */
export function resolveMasterFieldDefinitions(module: string, entity: string): FieldDefinitionsResponse | undefined {
  if (module !== "masters") {
    return undefined;
  }
  const master = MASTER_REGISTRY.find((candidate) => candidate.entity === entity);
  return master ? fieldDefinitionsForMaster(master.entity) : undefined;
}

function paramId(id: string | readonly string[] | undefined): string {
  return typeof id === "string" ? id : "";
}

function setActive(urlSegment: string, id: string | readonly string[] | undefined, isActive: boolean): Response {
  const rows = rowsByUrlSegment.get(urlSegment) ?? [];
  const row = rows.find((candidate) => candidate.id === paramId(id));
  if (!row) {
    return new HttpResponse(null, { status: 404 });
  }
  row.isActive = isActive;
  return HttpResponse.json(row);
}

/** One list/create/update/activate/deactivate handler set per master, generated from MASTER_REGISTRY - the same "zero new code per master" proof FE-5 asks of the frontend components, applied to the mocks that stand in for the real backend in tests. */
export const mastersHandlers = MASTER_REGISTRY.flatMap((master) => [
  http.get(`${API_BASE}/masters/${master.urlSegment}`, ({ request }) => {
    const rows = rowsByUrlSegment.get(master.urlSegment) ?? [];
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
    const search = url.searchParams.get("search")?.toLowerCase();
    const isActiveParam = url.searchParams.get("isActive");

    let filtered = rows;
    if (search) {
      filtered = filtered.filter(
        (row) => row.name.toLowerCase().includes(search) || row.code.toLowerCase().includes(search),
      );
    }
    if (isActiveParam !== null) {
      filtered = filtered.filter((row) => String(row.isActive) === isActiveParam);
    }

    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return HttpResponse.json(paginatedRowsResponseSchema.parse({ items, total, page, pageSize }));
  }),

  http.post(`${API_BASE}/masters/${master.urlSegment}`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const rows = rowsByUrlSegment.get(master.urlSegment) ?? [];
    nextMockId += 1;
    const row: MockMasterRow = {
      ...body,
      id: `${master.urlSegment}-${nextMockId}`,
      code: typeof body.code === "string" ? body.code : "",
      name: typeof body.name === "string" ? body.name : "",
      isActive: typeof body.isActive === "boolean" ? body.isActive : true,
      sortOrder: rows.length,
    };
    rows.push(row);
    rowsByUrlSegment.set(master.urlSegment, rows);
    return HttpResponse.json(row, { status: 201 });
  }),

  http.patch(`${API_BASE}/masters/${master.urlSegment}/:id/activate`, ({ params }) =>
    setActive(master.urlSegment, params.id, true),
  ),
  http.patch(`${API_BASE}/masters/${master.urlSegment}/:id/deactivate`, ({ params }) =>
    setActive(master.urlSegment, params.id, false),
  ),
  http.patch(`${API_BASE}/masters/${master.urlSegment}/:id`, async ({ params, request }) => {
    const rows = rowsByUrlSegment.get(master.urlSegment) ?? [];
    const row = rows.find((candidate) => candidate.id === paramId(params.id));
    if (!row) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(row, body);
    return HttpResponse.json(row);
  }),
]);
