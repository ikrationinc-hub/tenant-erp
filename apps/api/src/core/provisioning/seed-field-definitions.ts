import { sql } from "drizzle-orm";
import { withTenantSchema } from "../../database/get-db.js";
import { fieldDefinitions } from "../../database/tenant/schema.js";

export interface SeedFieldDefinitionsInput {
  schemaName: string;
  companyId: string;
  createdBy: string;
}

interface DefaultFieldDefinition {
  module: string;
  entity: string;
  fieldKey: string;
  label: string;
  isMandatory: boolean;
  sortOrder: number;
}

/**
 * A concrete, working example of Tier 2 (CLAUDE.md's field model) rather
 * than an attempt to cover every entity the catalogue names - "users.user"
 * is the one entity with real columns and a real module today; masters/
 * purchase don't have routes yet (core/module-registry/manifests.ts), so
 * there's nothing real to attach an override to for them.
 */
const DEFAULT_FIELD_DEFINITIONS: DefaultFieldDefinition[] = [
  { module: "users", entity: "user", fieldKey: "name", label: "Full Name", isMandatory: true, sortOrder: 0 },
  { module: "users", entity: "user", fieldKey: "email", label: "Email", isMandatory: false, sortOrder: 1 },
  { module: "users", entity: "user", fieldKey: "mobile", label: "Mobile", isMandatory: true, sortOrder: 2 },
];

/** Idempotent: onConflictDoUpdate against the (company_id, module, entity, field_key) unique index. */
export async function seedDefaultFieldDefinitions(input: SeedFieldDefinitionsInput): Promise<void> {
  await withTenantSchema(input.schemaName, async (tx) => {
    for (const field of DEFAULT_FIELD_DEFINITIONS) {
      await tx
        .insert(fieldDefinitions)
        .values({
          companyId: input.companyId,
          module: field.module,
          entity: field.entity,
          fieldKey: field.fieldKey,
          label: field.label,
          isMandatory: field.isMandatory,
          sortOrder: field.sortOrder,
          createdBy: input.createdBy,
        })
        .onConflictDoUpdate({
          target: [fieldDefinitions.companyId, fieldDefinitions.module, fieldDefinitions.entity, fieldDefinitions.fieldKey],
          targetWhere: sql`${fieldDefinitions.deletedAt} is null`,
          set: {
            label: field.label,
            isMandatory: field.isMandatory,
            sortOrder: field.sortOrder,
            updatedBy: input.createdBy,
            updatedAt: new Date(),
          },
        });
    }
  });
}
