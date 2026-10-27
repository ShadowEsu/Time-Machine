import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@timetm/core/verdict": fileURLToPath(new URL("./packages/core/src/verdict.ts", import.meta.url)),
      "@timetm/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "site/api/**/*.test.mjs"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
