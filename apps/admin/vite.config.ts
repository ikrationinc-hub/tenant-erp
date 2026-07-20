import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Default 5000ms is tight once a test mounts the full shell (Table +
    // Modal + Drawer, each with their own queries) under load - bumped to
    // give those renders headroom without masking a genuine hang.
    testTimeout: 10_000,
  },
});
