import { defineConfig } from "vitest/config";

// Plain Node runner for now; switches to @cloudflare/vitest-pool-workers when
// Durable Objects arrive in Phase 2.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
