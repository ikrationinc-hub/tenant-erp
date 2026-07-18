import { sql } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { fieldDefinitions } from "../../database/tenant/schema.js";
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
 * core/rbac/seed.ts's seedPermissionCatalogue.
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
          createdBy: input.createdBy,
          ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
          ...(field.optionsSource !== undefined ? { optionsSource: field.optionsSource } : {}),
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
            updatedBy: input.createdBy,
            updatedAt: new Date(),
          },
        });
    }
  });
}
