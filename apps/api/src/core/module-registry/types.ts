import type { Router } from "express";
import type { PermissionCatalogueEntry } from "../rbac/seed.js";

export interface ModuleManifest {
  key: string;
  name: string;
  version: string;
  /** Mounted at /api/v1/{key} by registry.ts's mountModules. Omit for a module that has no HTTP surface yet (e.g. a permissions-only placeholder). */
  routes?: Router;
  permissions: PermissionCatalogueEntry[];
  /** Module keys that must load (and be present in the registry) before this one. Cycles/missing deps fail fast at boot. */
  dependsOn: string[];
  /** Tenant migration versions (schema_migrations tags) this module's tables originated from - informational/audit metadata, not consumed by migration-runner.ts, which stays a single shared migration stream (see docs/adr/0003-cross-tenant-migration-runner.md). */
  migrations: string[];
}
