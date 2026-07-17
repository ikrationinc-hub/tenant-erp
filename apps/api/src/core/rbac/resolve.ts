import { sql } from "drizzle-orm";
import type { RequestContext } from "../../common/context/request-context.js";
import { withTenantDb, type TenantTx } from "../../database/get-db.js";
import { getCachedResolvedPermissions, getRoleVersion, setCachedResolvedPermissions } from "./cache.js";
import type { FieldPermission, ResolvedPermissions } from "./types.js";
import { fieldPermissionKey } from "./types.js";

interface FieldPermissionRow {
  module: string;
  entity: string;
  fieldKey: string;
  canView: boolean;
  canEdit: boolean;
}

interface ResolveQueryRow {
  permission_keys: string[] | null;
  field_permissions: FieldPermissionRow[] | null;
  [key: string]: unknown;
}

/**
 * The one query: a single round trip, two aggregate subqueries scoped to
 * the user's active (non-revoked) roles - not a join across
 * role_permissions and field_permissions in the same result set, which
 * would cartesian-multiply one against the other's row count.
 */
async function queryResolvedPermissions(tx: TenantTx, userId: string): Promise<ResolvedPermissions> {
  const result = await tx.execute<ResolveQueryRow>(sql`
    with my_roles as (
      select r.id
      from user_roles ur
      join roles r on r.id = ur.role_id and r.deleted_at is null
      where ur.user_id = ${userId} and ur.deleted_at is null
    )
    select
      coalesce(
        (select array_agg(distinct p.key)
         from role_permissions rp
         join permissions p on p.id = rp.permission_id
         where rp.role_id in (select id from my_roles) and rp.deleted_at is null),
        '{}'
      ) as permission_keys,
      coalesce(
        (select json_agg(json_build_object(
            'module', fp.module,
            'entity', fp.entity,
            'fieldKey', fp.field_key,
            'canView', fp.can_view,
            'canEdit', fp.can_edit
          ))
         from field_permissions fp
         where fp.role_id in (select id from my_roles) and fp.deleted_at is null),
        '[]'
      ) as field_permissions
  `);

  const row = result.rows[0];
  const permissions = new Set(row?.permission_keys ?? []);
  const fieldPermissions = new Map<string, FieldPermission>();
  for (const field of row?.field_permissions ?? []) {
    fieldPermissions.set(fieldPermissionKey(field.module, field.entity, field.fieldKey), {
      canView: field.canView,
      canEdit: field.canEdit,
    });
  }

  return { permissions, fieldPermissions };
}

/**
 * The task's shorthand is `resolve(userId)`; this takes the request context
 * instead because a versioned cache lookup and the tenant-scoped query both
 * need companyId and tenantSchema too - both already sit on
 * ctx.tenantScope, sourced from the JWT, at zero extra cost to the caller.
 * See docs/adr/0005-permission-engine.md.
 */
export async function resolve(ctx: RequestContext): Promise<ResolvedPermissions> {
  const scope = ctx.tenantScope;
  if (!scope?.userId) {
    throw new Error("resolve() called without a resolved user scope");
  }
  const { userId, companyId } = scope;

  const roleVersion = await getRoleVersion(companyId);
  const cached = await getCachedResolvedPermissions(userId, roleVersion);
  if (cached) {
    return cached;
  }

  const resolved = await withTenantDb(ctx, (tx) => queryResolvedPermissions(tx, userId));
  await setCachedResolvedPermissions(userId, roleVersion, resolved);
  return resolved;
}
