import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // LibreOffice headless conversion is slow relative to a typical unit
    // test - a cold soffice invocation can take several seconds.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
