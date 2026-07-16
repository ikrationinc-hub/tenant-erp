const TENANT_SCHEMA_NAME_PATTERN = /^tenant_[a-z0-9_]+$/;

/**
 * Every tenant schema name must match this shape before it is ever used in a
 * SQL statement (as a set_config value or a quoted identifier). This is
 * defense-in-depth on top of parameterized queries, not a substitute for
 * them - it exists so a corrupted or forged schema name fails loudly here
 * instead of silently resolving to an unexpected schema.
 */
export function assertValidTenantSchemaName(schemaName: string): string {
  if (!TENANT_SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new Error(`Invalid tenant schema name: ${JSON.stringify(schemaName)}`);
  }
  return schemaName;
}

export function slugToTenantSchemaName(slug: string): string {
  return assertValidTenantSchemaName(`tenant_${slug.toLowerCase().replace(/-/g, "_")}`);
}
