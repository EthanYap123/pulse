import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fastify's first boot can take several seconds on a cold, synced (OneDrive) disk.
    testTimeout: 30_000,
    // `pnpm test:coverage` runs unit and integration tests together and enforces these.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "lcov"],
      include: ["src/**/*.ts"],
      // server.ts only wires config to the app and starts listening.
      exclude: ["src/**/*.test.ts", "src/generated/**", "src/server.ts"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["test/**/*.int.test.ts"],
          globalSetup: ["./test/global-setup.ts"],
          setupFiles: ["dotenv/config"],
          // One database for the whole run; files must not race each other.
          fileParallelism: false,
        },
      },
    ],
  },
});
