const TENANT_SCHEMA_NAME_PATTERN = /^tenant_[a-z0-9_]+$/;

/**
 * Mirrors apps/api/src/database/tenant/schema-name.ts exactly - apps/api
 * isn't set up as an importable workspace package (no exports/main/types
 * pointing at a build output), so the worker keeps its own copy of this
 * validator rather than reaching into another app's src/. Keep both in
 * sync if the tenant schema naming convention ever changes.
 */
export function assertValidTenantSchemaName(schemaName: string): string {
  if (!TENANT_SCHEMA_NAME_PATTERN.test(schemaName)) {
    throw new Error(`Invalid tenant schema name: ${JSON.stringify(schemaName)}`);
  }
  return schemaName;
}
