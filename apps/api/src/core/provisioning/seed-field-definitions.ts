import { eq, sql } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { divisions, fieldDefinitions } from "../../database/tenant/schema.js";
import { logger } from "../../config/logger.js";
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
    // C-3a: FIELD_DEFAULTS entries reference a division by CODE
    // (FieldDefault.divisionCode's own doc comment explains why - a
    // static code-declared array can't hold this company's own
    // divisions.id, generated later at seed time). Resolve every code
    // this company's field defaults actually reference to its real
    // division_id ONCE, up front - seedMasterData (core/masters/
    // seed-data.ts) normally runs before this in provision-tenant.ts's own
    // call order, but a company that never got the standard divisions set
    // (e.g. a minimal test fixture that only seeds what one unrelated
    // test needs) is a real, valid state, not a configuration error - a
    // division-scoped field with no matching division for THIS company is
    // silently skipped (logged, not thrown), same self-healing spirit as
    // this function's own re-run-safe onConflictDoUpdate: it seeds
    // correctly the next time this runs after that company's divisions
    // exist, rather than failing every OTHER field in the same batch.
    const distinctDivisionCodes = [...new Set(FIELD_DEFAULTS.map((field) => field.divisionCode).filter((code) => code !== undefined))];
    const divisionIdByCode = new Map<string, string>();
    if (distinctDivisionCodes.length > 0) {
      const divisionRows = await tx.select({ id: divisions.id, code: divisions.code }).from(divisions).where(eq(divisions.companyId, input.companyId));
      for (const row of divisionRows) {
        divisionIdByCode.set(row.code, row.id);
      }
      for (const code of distinctDivisionCodes) {
        if (!divisionIdByCode.has(code)) {
          logger.warn(
            { companyId: input.companyId, divisionCode: code },
            "field-engine default references a division code this company has no row for - skipping that field for now",
          );
        }
      }
    }

    for (const field of FIELD_DEFAULTS) {
      if (field.divisionCode !== undefined && !divisionIdByCode.has(field.divisionCode)) {
        continue;
      }
      const divisionId = field.divisionCode !== undefined ? divisionIdByCode.get(field.divisionCode) : undefined;
      // C-3a: two DIFFERENT partial unique indexes exist now (schema.ts's
      // own doc comment on field_definitions.divisionId explains why a
      // single 5-column index can't work with a nullable division_id) -
      // onConflictDoUpdate's target/targetWhere must match whichever one
      // this field's divisionId actually falls under, or Postgres has no
      // matching arbiter constraint to conflict against.
      const isDivisionScoped = divisionId !== undefined;
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
          ...(divisionId !== undefined ? { divisionId } : {}),
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
        .onConflictDoUpdate(
          isDivisionScoped
            ? {
                target: [
                  fieldDefinitions.companyId,
                  fieldDefinitions.module,
                  fieldDefinitions.entity,
                  fieldDefinitions.fieldKey,
                  fieldDefinitions.divisionId,
                ],
                targetWhere: sql`${fieldDefinitions.deletedAt} is null and ${fieldDefinitions.divisionId} is not null`,
                set: {
                  label: field.label,
                  isVisible: field.isVisible,
                  isMandatory: field.isMandatory,
                  isEditable: field.isEditable,
                  sortOrder: field.sortOrder,
                  isSystem: field.isSystem,
                  allowCreate: field.allowCreate ?? false,
                  optionsSource: typeof field.optionsSource === "string" ? field.optionsSource : null,
                  defaultValue: field.defaultValue ?? null,
                  updatedBy: input.createdBy,
                  updatedAt: new Date(),
                },
              }
            : {
                target: [fieldDefinitions.companyId, fieldDefinitions.module, fieldDefinitions.entity, fieldDefinitions.fieldKey],
                targetWhere: sql`${fieldDefinitions.deletedAt} is null and ${fieldDefinitions.divisionId} is null`,
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
              },
        );
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
