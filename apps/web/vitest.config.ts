import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      // Logic only. Pages, components and the useData hook are covered by the Phase 5
      // Playwright tests, which drive the real UI.
      include: ["src/lib/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/lib/use-data.ts", "src/lib/types.ts"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
