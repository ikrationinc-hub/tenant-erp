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
    // a resource-contention flake, not a logic bug (confirmed: this dev
    // machine runs multiple unrelated projects/sessions concurrently,
    // sustained load average 5+). 30s gives real CI/dev machines headroom
    // without masking an actually-hung test.
    testTimeout: 30000,
  },
});
