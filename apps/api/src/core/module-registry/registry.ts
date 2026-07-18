import type { PermissionCatalogueEntry } from "../rbac/types.js";
import { MODULE_MANIFESTS } from "./manifests.js";
import type { ModuleManifest } from "./types.js";

/**
 * Topological sort by dependsOn (Kahn's algorithm) - fails fast at boot
 * (not at first request) on a missing dependency or a cycle, both of
 * which are configuration errors that should never reach runtime.
 */
export function resolveLoadOrder(manifests: ModuleManifest[]): ModuleManifest[] {
  const byKey = new Map(manifests.map((manifest) => [manifest.key, manifest]));

  for (const manifest of manifests) {
    for (const dep of manifest.dependsOn) {
      if (!byKey.has(dep)) {
        throw new Error(`Module "${manifest.key}" depends on unknown module "${dep}"`);
      }
    }
  }

  const resolved: ModuleManifest[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(manifest: ModuleManifest): void {
    if (visited.has(manifest.key)) {
      return;
    }
    if (visiting.has(manifest.key)) {
      throw new Error(`Module dependency cycle detected at "${manifest.key}"`);
    }

    visiting.add(manifest.key);
    for (const dep of manifest.dependsOn) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- presence already checked above
      visit(byKey.get(dep)!);
    }
    visiting.delete(manifest.key);
    visited.add(manifest.key);
    resolved.push(manifest);
  }

  for (const manifest of manifests) {
    visit(manifest);
  }

  return resolved;
}

/** Boot-time, not per-request: throws immediately if the shipped manifest list is malformed. */
export const RESOLVED_MODULES: ModuleManifest[] = resolveLoadOrder(MODULE_MANIFESTS);

/**
 * Flattens every registered module's declared permissions into one
 * catalogue, replacing the hand-maintained static list core/rbac/seed.ts
 * used before the registry existed. Throws on a duplicate key across
 * modules - two modules independently declaring "users.user.create" is a
 * manifest bug, not something to silently pick a winner for.
 */
export function getPermissionCatalogue(): PermissionCatalogueEntry[] {
  const catalogue: PermissionCatalogueEntry[] = [];
  const seenKeys = new Set<string>();

  for (const manifest of RESOLVED_MODULES) {
    for (const permission of manifest.permissions) {
      if (seenKeys.has(permission.key)) {
        throw new Error(
          `Duplicate permission key "${permission.key}" declared by module "${manifest.key}"`,
        );
      }
      seenKeys.add(permission.key);
      catalogue.push(permission);
    }
  }

  return catalogue;
}

export function getModuleManifest(key: string): ModuleManifest | undefined {
  return RESOLVED_MODULES.find((manifest) => manifest.key === key);
}
