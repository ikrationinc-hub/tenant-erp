import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // The default 5000ms gets tight once several renderApp() suites (real
    // router + MSW + userEvent) run in parallel across worker processes -
    // a resource-contention flake, not a logic bug. 15s gives real CI/dev
    // machines headroom without masking an actually-hung test.
    testTimeout: 15000,
  },
});
