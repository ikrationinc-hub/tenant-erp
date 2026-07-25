import tseslint from "typescript-eslint";
import { baseConfig } from "@ikration/config/eslint";

export default tseslint.config(baseConfig, {
  // Standalone Node script, not part of the tsconfig project - type-aware
  // rules can't resolve types for it anyway.
  files: ["scripts/**/*.mjs"],
  ...tseslint.configs.disableTypeChecked,
});
