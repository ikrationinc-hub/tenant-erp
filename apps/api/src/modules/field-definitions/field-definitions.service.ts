import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { resolveFieldDefinitions } from "../../core/field-engine/resolve.js";
import { updateFieldDefinition as coreUpdateFieldDefinition } from "../../core/field-engine/mutations.js";
import { FIELD_DEFAULTS } from "../../core/field-engine/defaults.js";
import type { EffectiveField } from "../../core/field-engine/types.js";
import type { UpdateFieldDefinitionRequestBody } from "./field-definitions.validator.js";

function requireTenantScope(ctx: RequestContext) {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return { ...scope, userId: scope.userId };
}

export async function getFieldDefinitions(
  ctx: RequestContext,
  module: string,
  entity: string,
): Promise<EffectiveField[]> {
  return resolveFieldDefinitions(ctx, module, entity);
}

export interface FieldDefinitionModulePair {
  module: string;
  entity: string;
}

/**
 * Every distinct (module, entity) pair with field definitions - sourced
 * from FIELD_DEFAULTS (already includes every master's generated
 * defaults, core/field-engine/defaults.ts), not hardcoded, so a new
 * module/entity shows up here automatically. Sorted for a stable picker
 * order across requests.
 */
export function listFieldDefinitionModules(): FieldDefinitionModulePair[] {
  const seen = new Set<string>();
  const pairs: FieldDefinitionModulePair[] = [];
  for (const field of FIELD_DEFAULTS) {
    const key = `${field.module}/${field.entity}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    pairs.push({ module: field.module, entity: field.entity });
  }
  return pairs.sort((a, b) => `${a.module}/${a.entity}`.localeCompare(`${b.module}/${b.entity}`));
}

export async function updateFieldDefinition(
  ctx: RequestContext,
  id: string,
  input: UpdateFieldDefinitionRequestBody,
) {
  const scope = requireTenantScope(ctx);
  return coreUpdateFieldDefinition({
    id,
    companyId: scope.companyId,
    schemaName: scope.tenantSchema,
    updatedBy: scope.userId,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
    ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.allowCreate !== undefined ? { allowCreate: input.allowCreate } : {}),
  });
}
