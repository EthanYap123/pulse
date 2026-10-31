import type { Config } from "../../src/config.js";

/** Config for tests. The secrets are fixed, non-secret test values. */
export const testConfig: Config = {
  databaseUrl: "postgresql://unused@localhost/unused",
  jwtSecret: "pulse-test-only-jwt-secret-not-used-elsewhere",
  encryptionKey: "00".repeat(32),
  port: 0,
  version: "test",
  cookie: { path: "/api/v1/auth", secure: false },
};
