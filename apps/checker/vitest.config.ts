import { defineConfig } from "vitest/config";

// The checker's logic (run-checks, shard-core, routes, db) has no Cloudflare imports, so it
// is tested in Node: node:sqlite stands in for Durable Object storage and a real Postgres
// for Neon. The thin Durable Object wrapper is exercised with `wrangler dev`.
export default defineConfig({
  test: {
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
