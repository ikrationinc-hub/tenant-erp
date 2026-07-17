import type { NextFunction, Request, Response } from "express";
import { getRequestContext } from "../context/request-context.js";
import { resolve } from "../../core/rbac/resolve.js";
import { fieldPermissionKey } from "../../core/rbac/types.js";
import type { FieldPermission, ResolvedPermissions } from "../../core/rbac/types.js";
import { ForbiddenError, UnauthorizedError } from "../errors/index.js";

/**
 * Field-level RBAC has exactly two enforcement points (task item 5) - never
 * a check scattered inside business logic:
 *
 * 1. WRITE, before validation: rejectWriteForbiddenFields - a field the
 *    role cannot edit, present in the body, is a 403 naming the field.
 *    Never a silent strip (that produces "I saved it and it didn't save"
 *    tickets - CLAUDE.md/the plan doc are explicit about this).
 * 2. READ, at serialization: sendFiltered/stripNonViewableFields - strips
 *    non-viewable fields. Built as something the response layer calls
 *    (sendFiltered replaces res.json in a protected controller), not
 *    something each route must remember to invoke separately.
 *
 * A field with no matching field_permissions row is allowed (both view and
 * edit): field_permissions is an optional, additional restriction on top of
 * the coarser module.entity.action permission check, not a default-deny
 * allowlist of every field that exists.
 */

export function rejectWriteForbiddenFields(module: string, entity: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = getRequestContext();
      if (!ctx?.tenantScope?.userId) {
        throw new UnauthorizedError("Missing bearer token");
      }

      const resolved = await resolve(ctx);
      const body = req.body as unknown;

      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const field of Object.keys(body)) {
          const rule = resolved.fieldPermissions.get(fieldPermissionKey(module, entity, field));
          if (rule && !rule.canEdit) {
            throw new ForbiddenError(`Field is not editable: ${field}`, { field });
          }
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

function stripRecord(
  fieldPermissions: Map<string, FieldPermission>,
  module: string,
  entity: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    const rule = fieldPermissions.get(fieldPermissionKey(module, entity, field));
    if (rule && !rule.canView) {
      continue;
    }
    result[field] = value;
  }
  return result;
}

/**
 * Strips non-viewable fields from a single object OR an array of objects
 * (list endpoints) - the same function covers both, so a list response
 * can't accidentally skip the check a single-GET response remembered.
 */
export function stripNonViewableFields<T>(
  resolved: Pick<ResolvedPermissions, "fieldPermissions">,
  module: string,
  entity: string,
  data: T,
): T {
  if (Array.isArray(data)) {
    const items: unknown[] = data;
    return items.map((item) =>
      item && typeof item === "object"
        ? stripRecord(resolved.fieldPermissions, module, entity, item as Record<string, unknown>)
        : item,
    ) as T;
  }
  if (data && typeof data === "object") {
    return stripRecord(resolved.fieldPermissions, module, entity, data as Record<string, unknown>) as T;
  }
  return data;
}

/**
 * The serializer the response layer calls (task item 5) - a protected
 * controller uses this instead of `res.json(data)`, so read-side field
 * stripping cannot be forgotten per-route the way a manually-invoked helper
 * could be.
 */
export async function sendFiltered(
  res: Response,
  module: string,
  entity: string,
  data: unknown,
  statusCode = 200,
): Promise<void> {
  const ctx = getRequestContext();
  if (!ctx?.tenantScope?.userId) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const resolved = await resolve(ctx);
  res.status(statusCode).json(stripNonViewableFields(resolved, module, entity, data));
}
