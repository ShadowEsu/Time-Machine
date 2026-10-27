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
    // Each test file's temp folders go in one folder of its own, removed when the file is done.
    setupFiles: ["./fixtures/vitest-tmp.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
