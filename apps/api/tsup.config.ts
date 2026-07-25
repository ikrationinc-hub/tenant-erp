import { cpSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: false,
  // migration-runner.ts resolves TENANT_MIGRATIONS_FOLDER relative to its own
  // compiled file location (import.meta.url), matching the source tree's
  // src/database/ -> src/database/tenant/migrations layout. tsup only
  // bundles JS, so the raw .sql/meta files need to be copied into the same
  // relative position under dist/ or tenant provisioning (which runs the
  // compiled dist/server.js, unlike the tsx-run migrate-tenants.ts CLI
  // script) can never find them at runtime.
  onSuccess: () => {
    cpSync("src/database/tenant/migrations", "dist/tenant/migrations", { recursive: true });
  },
});
