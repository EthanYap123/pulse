import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fastify's first boot can take several seconds on a cold, synced (OneDrive) disk.
    testTimeout: 30_000,
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
          setupFiles: ["./test/setup-env.ts"],
          // One database for the whole run; files must not race each other.
          fileParallelism: false,
        },
      },
    ],
  },
});
