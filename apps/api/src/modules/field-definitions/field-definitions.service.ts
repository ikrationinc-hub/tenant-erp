import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { resolveFieldDefinitions } from "../../core/field-engine/resolve.js";
import { updateFieldDefinition as coreUpdateFieldDefinition } from "../../core/field-engine/mutations.js";
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
  });
}
