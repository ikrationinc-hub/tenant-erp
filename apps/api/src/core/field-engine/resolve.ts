import { eq, and, isNull, or } from "drizzle-orm";
import type { RequestContext } from "../../common/context/request-context.js";
import { UnauthorizedError } from "../../common/errors/index.js";
import { withTenantDb, withTenantSchema } from "../../database/get-db.js";
import { divisions, fieldDefinitions } from "../../database/tenant/schema.js";
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
    allowCreate: row.allowCreate,
    // Falls back to the CODE default, not to undefined: the DB column is
    // a plain string, so it can only ever hold the bare "masters:x"/
    // "roles" convention, never the richer static-enum object form
    // (core/field-engine/types.ts's StaticOptionsSource) - a field whose
    // code default is a static enum must keep resolving to it even once
    // a field_definitions row exists (which nothing today ever populates
    // optionsSource on anyway - see field-definitions.validator.ts, it
    // isn't even PATCH-able). Without this fallback, provisioning a row
    // at all would silently erase a code-declared static option list.
    optionsSource: row.optionsSource ?? fallback.optionsSource,
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
 *
 * C-3a (docs/CONTRACT-MODULE-BUILD.md): `divisionId` is optional - when
 * given, a row scoped to THAT division and a row scoped to no division
 * (division_id IS NULL, "applies to all divisions") can both exist for
 * the same fieldKey; the division-specific row wins (see the two-pass
 * `rowsByFieldKey` build below - NULL-division rows are laid down first,
 * then overwritten by division-specific ones). When `divisionId` is
 * omitted entirely, only NULL-division rows are considered - the
 * pre-C-3a behavior for every existing module/entity that has never had a
 * division-scoped row.
 */
export async function resolveBaseFieldDefinitions(
  companyId: string,
  schemaName: string,
  module: string,
  entity: string,
  divisionId?: string,
): Promise<EffectiveField[]> {
  const fieldVersion = await getFieldVersion(companyId, module, entity);
  const cached = await getCachedFieldDefinitions<EffectiveField[]>(companyId, module, entity, fieldVersion, divisionId);
  if (cached) {
    return cached;
  }

  const divisionCondition = divisionId
    ? or(isNull(fieldDefinitions.divisionId), eq(fieldDefinitions.divisionId, divisionId))
    : isNull(fieldDefinitions.divisionId);

  // getFieldDefaults (defaults.ts) is keyed by division CODE ("SCRAP"),
  // not divisionId/UUID - a FieldDefault is a static, code-declared
  // constant evaluated before any company's own divisions rows (with
  // their own generated ids) exist, so a UUID can never be a code
  // default's own field. Look up this specific division's code once here,
  // where a real tenant schema connection is already open.
  const [divisionRow, rows] = await withTenantSchema(schemaName, async (tx) => {
    const division = divisionId
      ? (await tx.select({ code: divisions.code }).from(divisions).where(eq(divisions.id, divisionId)).limit(1))[0]
      : undefined;
    const fieldRows = await tx
      .select()
      .from(fieldDefinitions)
      .where(and(eq(fieldDefinitions.companyId, companyId), eq(fieldDefinitions.module, module), eq(fieldDefinitions.entity, entity), divisionCondition));
    return [division, fieldRows] as const;
  });

  const defaults = getFieldDefaults(module, entity, divisionRow?.code);

  // Two-pass build: NULL-division ("all divisions") rows first, then
  // division-specific rows overwrite them for the same fieldKey - a
  // division-specific override always wins over the shared default.
  const rowsByFieldKey = new Map(rows.filter((row) => row.divisionId === null).map((row) => [row.fieldKey, row]));
  for (const row of rows) {
    if (row.divisionId !== null) {
      rowsByFieldKey.set(row.fieldKey, row);
    }
  }

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
        allowCreate: fallback.allowCreate,
        fieldType: fallback.fieldType,
        validationJson: fallback.validationJson,
        sortOrder: fallback.sortOrder,
        isSystem: fallback.isSystem,
        section: fallback.section,
      };
      return mergeRow(rowsByFieldKey.get(fallback.fieldKey), base);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  await setCachedFieldDefinitions(companyId, module, entity, fieldVersion, resolved, divisionId);
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
  divisionId?: string,
): Promise<EffectiveField[]> {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const [base, permissions] = await Promise.all([
    resolveBaseFieldDefinitions(scope.companyId, scope.tenantSchema, module, entity, divisionId),
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
