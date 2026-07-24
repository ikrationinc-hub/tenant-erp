import { eq, and } from "drizzle-orm";
import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { withTenantDb, withTenantSchema } from "../../database/get-db.js";
import { fieldDefinitions } from "../../database/tenant/schema.js";
import { fieldPermissionKey } from "../rbac/types.js";
import { resolve as resolvePermissions } from "../rbac/resolve.js";
import { getFieldDefaults } from "./defaults.js";
import { getCachedFieldDefinitions, getFieldVersion, setCachedFieldDefinitions } from "./cache.js";
import type { EffectiveField } from "./types.js";

type FieldDefinitionRow = typeof fieldDefinitions.$inferSelect;

function mergeRow(row: FieldDefinitionRow | undefined, fallback: EffectiveField): EffectiveField {
  if (!row) {
    return fallback;
  }
  return {
    ...fallback,
    id: row.id,
    label: row.label,
    isVisible: row.isVisible,
    isMandatory: row.isMandatory,
    isEditable: row.isEditable,
    defaultValue: row.defaultValue ?? undefined,
    optionsSource: row.optionsSource ?? undefined,
    validationJson: row.validationJson ?? undefined,
    sortOrder: row.sortOrder,
    isSystem: row.isSystem,
    // Deliberately NOT taken from the row: dataType/module/entity/
    // fieldKey/tier are immutable, always the code-declared truth (rule:
    // "data_type is NEVER overridable"). A row only ever agrees with
    // these anyway (provisioning materializes it from the same default),
    // but resolving from the code default here, not the row, is what
    // makes that guarantee structural rather than incidental.
  };
}

/**
 * The company-wide (not per-user) merged view: code defaults layered
 * under whatever field_definitions rows this company has. Cached by
 * core/field-engine/cache.ts, keyed by field_version - bumped by every
 * core/field-engine/mutations.ts write, nothing else touches this table.
 */
export async function resolveBaseFieldDefinitions(
  companyId: string,
  schemaName: string,
  module: string,
  entity: string,
): Promise<EffectiveField[]> {
  const fieldVersion = await getFieldVersion(companyId, module, entity);
  const cached = await getCachedFieldDefinitions<EffectiveField[]>(companyId, module, entity, fieldVersion);
  if (cached) {
    return cached;
  }

  const defaults = getFieldDefaults(module, entity);

  const rows = await withTenantSchema(schemaName, (tx) =>
    tx
      .select()
      .from(fieldDefinitions)
      .where(and(eq(fieldDefinitions.companyId, companyId), eq(fieldDefinitions.module, module), eq(fieldDefinitions.entity, entity))),
  );
  const rowsByFieldKey = new Map(rows.map((row) => [row.fieldKey, row]));

  const resolved = defaults
    .map((fallback): EffectiveField => {
      const base: EffectiveField = {
        id: undefined,
        module: fallback.module,
        entity: fallback.entity,
        fieldKey: fallback.fieldKey,
        tier: 2,
        label: fallback.label,
        dataType: fallback.dataType,
        isVisible: fallback.isVisible,
        isMandatory: fallback.isMandatory,
        isEditable: fallback.isEditable,
        defaultValue: fallback.defaultValue,
        optionsSource: fallback.optionsSource,
        multiple: fallback.multiple,
        validationJson: fallback.validationJson,
        sortOrder: fallback.sortOrder,
        isSystem: fallback.isSystem,
      };
      return mergeRow(rowsByFieldKey.get(fallback.fieldKey), base);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  await setCachedFieldDefinitions(companyId, module, entity, fieldVersion, resolved);
  return resolved;
}

/**
 * The full resolve() the task describes: the cached company-wide result,
 * further narrowed by the REQUESTING user's RBAC field permissions
 * (core/rbac/resolve.ts, itself cached separately by role_version) - a
 * field this company hasn't restricted can still be invisible/read-only
 * to a specific user whose ROLE has a field_permissions row for it.
 * Deliberately uncached at this layer: cheap once both cached pieces
 * exist, and caching it again per-user would need a third version
 * component this task's own cache key spec doesn't have room for.
 */
export async function resolveFieldDefinitions(
  ctx: RequestContext,
  module: string,
  entity: string,
): Promise<EffectiveField[]> {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const [base, permissions] = await Promise.all([
    resolveBaseFieldDefinitions(scope.companyId, scope.tenantSchema, module, entity),
    resolvePermissions(ctx),
  ]);

  return base.map((field) => {
    const rule = permissions.fieldPermissions.get(fieldPermissionKey(module, entity, field.fieldKey));
    if (!rule) {
      return field;
    }
    return {
      ...field,
      isVisible: field.isVisible && rule.canView,
      isEditable: field.isEditable && rule.canEdit,
    };
  });
}

export async function findFieldDefinitionById(
  ctx: RequestContext,
  id: string,
): Promise<FieldDefinitionRow | undefined> {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }
  return withTenantDb(ctx, async (tx) => {
    const [row] = await tx.select().from(fieldDefinitions).where(eq(fieldDefinitions.id, id)).limit(1);
    return row;
  });
}
