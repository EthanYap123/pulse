import { defineConfig } from "vitest/config";

// The checker's logic (run-checks, shard-core, routes, db) has no Cloudflare imports, so it
// is tested in Node: node:sqlite stands in for Durable Object storage and a real Postgres
// for Neon. The thin Durable Object wrapper is exercised with `wrangler dev`.
export default defineConfig({
  test: {
    // `pnpm test:coverage` runs unit and integration tests together and enforces these.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      include: ["src/**/*.ts"],
      // Cloudflare-only glue (imports cloudflare:workers), checked with `wrangler dev`.
      exclude: [
        "src/shard.ts",
        "src/snapshots.ts",
        "src/do-sql.ts",
        "src/index.ts",
        "src/env.ts",
        "src/types/**",
      ],
      thresholds: { lines: 85, functions: 85, statements: 85, branches: 85 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/**/*.int.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          setupFiles: ["./test/load-env.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
