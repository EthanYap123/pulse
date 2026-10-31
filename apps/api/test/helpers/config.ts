import type { Config } from "../../src/config.js";

/** Config for tests. The JWT secret is a fixed, non-secret test value. */
export const testConfig: Config = {
  databaseUrl: "postgresql://unused@localhost/unused",
  jwtSecret: "pulse-test-only-jwt-secret-not-used-elsewhere",
  port: 0,
  version: "test",
  cookie: { path: "/api/v1/auth", secure: false },
};
