/**
 * Where the E2E stack runs. Its ports and database are its own, so a run never touches the
 * local dev servers, dev data or anything hosted. Every secret here is a fixed test value.
 */
export const PORTS = { web: 3100, api: 4100, checker: 8887, inspector: 9329 } as const;

export const WEB_URL = `http://localhost:${PORTS.web}`;
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const CHECKER_URL = `http://127.0.0.1:${PORTS.checker}`;

export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://pulse:pulse@localhost:5434/pulse_e2e";

const HMAC_SECRET = "e2e-test-only-not-a-real-secret";
const ENCRYPTION_KEY = "0".repeat(64);

export const apiEnv = {
  // Not "production", so the refresh cookie works over plain http.
  NODE_ENV: "test",
  PORT: String(PORTS.api),
  APP_VERSION: "e2e",
  DATABASE_URL,
  JWT_SECRET: "e2e-test-only-jwt-secret-not-a-real-secret",
  ENCRYPTION_KEY,
  CHECKER_URL,
  CHECKER_HMAC_SECRET: HMAC_SECRET,
};

export const checkerVars = {
  ENVIRONMENT: "e2e",
  DB_DRIVER: "pg",
  DATABASE_URL,
  CHECKER_HMAC_SECRET: HMAC_SECRET,
  ENCRYPTION_KEY,
};

// next.config.ts bakes API_URL in at build time, so the web app is built with these too.
export const webEnv = { API_URL, CHECKER_URL };
