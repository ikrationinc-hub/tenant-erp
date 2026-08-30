import { sql } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { fieldDefinitions } from "../../database/tenant/schema.js";
import { bumpFieldVersion } from "../field-engine/cache.js";
import { FIELD_DEFAULTS } from "../field-engine/defaults.js";

export interface SeedFieldDefinitionsInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
}

/**
 * Materializes one field_definitions row per core/field-engine/
 * defaults.ts entry - core/field-engine/defaults.ts is the single source
 * of truth for what Tier 2 fields exist; this just makes sure every
 * company gets a real row (and therefore a real PATCH-able id) for each
 * of them from day one, rather than lazily creating one on first
 * override. Idempotent: onConflictDoUpdate against the (company_id,
 * module, entity, field_key) unique index, re-run-safe exactly like
 * core/rbac/seed.ts's seedPermissionCatalogue. After the seeding
 * transaction commits, bumps the field version for every distinct
 * (module, entity) pair touched so a warm resolve.ts cache entry doesn't
 * keep serving pre-seed results for up to the cache's 1-hour TTL.
 */
export async function seedDefaultFieldDefinitions(input: SeedFieldDefinitionsInput): Promise<void> {
  await withTenantSchema(input.schemaName, async (tx) => {
    for (const field of FIELD_DEFAULTS) {
      await tx
        .insert(fieldDefinitions)
        .values({
          companyId: input.companyId,
          module: field.module,
          entity: field.entity,
          fieldKey: field.fieldKey,
          label: field.label,
          dataType: field.dataType,
          isVisible: field.isVisible,
          isMandatory: field.isMandatory,
          isEditable: field.isEditable,
          sortOrder: field.sortOrder,
          isSystem: field.isSystem,
          allowCreate: field.allowCreate ?? false,
          createdBy: input.createdBy,
          ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
          // Only the bare-string convention is ever written to this text
          // column - a static-enum object (FieldOptionsSource's other
          // member) has no column to live in, and doesn't need one:
          // core/field-engine/resolve.ts's mergeRow falls back to the code
          // default whenever the row itself has no optionsSource, which is
          // always true for these fields (never PATCH-able today).
          ...(typeof field.optionsSource === "string" ? { optionsSource: field.optionsSource } : {}),
          ...(field.validationJson !== undefined ? { validationJson: field.validationJson } : {}),
        })
        .onConflictDoUpdate({
          target: [fieldDefinitions.companyId, fieldDefinitions.module, fieldDefinitions.entity, fieldDefinitions.fieldKey],
          targetWhere: sql`${fieldDefinitions.deletedAt} is null`,
          set: {
            label: field.label,
            isVisible: field.isVisible,
            isMandatory: field.isMandatory,
            isEditable: field.isEditable,
            sortOrder: field.sortOrder,
            isSystem: field.isSystem,
            allowCreate: field.allowCreate ?? false,
            // Nothing PATCH-able ever writes these two (field-definitions.
            // validator.ts's updateFieldDefinitionSchema doesn't accept
            // either) - core/field-engine/defaults.ts is their only real
            // source, so a re-seed must refresh them too. Omitting them
            // from this `set` was itself a real bug: a field whose code
            // default CHANGED (e.g. purchase/header's buyerId moving from
            // optionsSource "users" to "companies") kept resolving to the
            // stale DB value forever on an already-provisioned tenant,
            // since resolve.ts's mergeRow always prefers a non-null row
            // value over the code fallback.
            optionsSource: typeof field.optionsSource === "string" ? field.optionsSource : null,
            defaultValue: field.defaultValue ?? null,
            updatedBy: input.createdBy,
            updatedAt: new Date(),
          },
        });
    }
  });

  const distinctPairs = new Map<string, { module: string; entity: string }>();
  for (const field of FIELD_DEFAULTS) {
    distinctPairs.set(`${field.module}/${field.entity}`, { module: field.module, entity: field.entity });
  }
  await Promise.all(
    Array.from(distinctPairs.values()).map(({ module, entity }) => bumpFieldVersion(input.companyId, module, entity)),
  );
}
