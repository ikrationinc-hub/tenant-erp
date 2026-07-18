import { and, eq } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "../../common/errors/index.js";
import { withTenantSchema } from "../../database/get-db.js";
import { fieldDefinitions } from "../../database/tenant/schema.js";
import { insertAuditLog } from "../audit/write.js";
import { bumpFieldVersion } from "./cache.js";

type FieldDefinitionRow = typeof fieldDefinitions.$inferSelect;

export interface UpdateFieldDefinitionInput {
  id: string;
  companyId: string;
  schemaName: string;
  /** Only label/is_visible/is_mandatory/sort_order (task item 3) - field_key, tier, and data_type are structurally absent from this type, not merely optional, so there's no code path that could even attempt to set them. */
  label?: string;
  isVisible?: boolean;
  isMandatory?: boolean;
  sortOrder?: number;
  updatedBy: string;
}

/**
 * The only way a field_definitions row changes (mirrors every other
 * core/*\/mutations.ts in this codebase). Enforces the two guardrails
 * that must hold regardless of what the HTTP layer already validated
 * (CLAUDE.md field model / task item 4):
 *
 * - is_system fields cannot be hidden (isVisible: false) or made
 *   optional (isMandatory: false) - tightening either is fine, loosening
 *   either is rejected outright.
 * - data_type is never in this function's input type at all - "never
 *   overridable" is structural, not a runtime check that could be
 *   forgotten.
 *
 * "Emit a field_definition.changed event -> invalidate cache" (task item
 * 5): this codebase has no event bus anywhere (role_version/menu_version
 * invalidate the same way) - bumpFieldVersion after the write commits IS
 * the invalidation, and the audit_logs row recorded in the same
 * transaction (action: "field_definition.changed") is the durable record
 * of the change event itself.
 */
export async function updateFieldDefinition(input: UpdateFieldDefinitionInput): Promise<FieldDefinitionRow> {
  const updated = await withTenantSchema(input.schemaName, async (tx) => {
    const [existing] = await tx
      .select()
      .from(fieldDefinitions)
      .where(and(eq(fieldDefinitions.id, input.id), eq(fieldDefinitions.companyId, input.companyId)))
      .limit(1);
    if (!existing) {
      throw new NotFoundError("Field definition not found");
    }

    if (existing.isSystem) {
      if (input.isVisible === false) {
        throw new ForbiddenError("A system field cannot be hidden", { fieldKey: existing.fieldKey });
      }
      if (input.isMandatory === false) {
        throw new ForbiddenError("A system field cannot be made optional", { fieldKey: existing.fieldKey });
      }
    }

    const [row] = await tx
      .update(fieldDefinitions)
      .set({
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.isVisible !== undefined ? { isVisible: input.isVisible } : {}),
        ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
        version: existing.version + 1,
      })
      .where(eq(fieldDefinitions.id, input.id))
      .returning();
    if (!row) {
      throw new Error("failed to update field definition");
    }

    await insertAuditLog(tx, {
      companyId: input.companyId,
      changedBy: input.updatedBy,
      entity: "field_definition",
      entityId: input.id,
      action: "field_definition.changed",
      before: {
        label: existing.label,
        isVisible: existing.isVisible,
        isMandatory: existing.isMandatory,
        sortOrder: existing.sortOrder,
      },
      after: { label: row.label, isVisible: row.isVisible, isMandatory: row.isMandatory, sortOrder: row.sortOrder },
    });

    return row;
  });

  await bumpFieldVersion(input.companyId, updated.module, updated.entity);
  return updated;
}
