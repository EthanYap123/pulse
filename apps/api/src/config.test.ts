import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5434/pulse",
  JWT_SECRET: "x".repeat(32),
  ENCRYPTION_KEY: "ab".repeat(32),
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      jwtSecret: base.JWT_SECRET,
      encryptionKey: base.ENCRYPTION_KEY,
      port: 4000,
      version: "dev",
      commit: "unknown",
      cookie: { path: "/api/v1/auth", secure: false },
      checker: null,
    });
  });

  it("uses Secure cookies in production", () => {
    expect(loadConfig({ ...base, NODE_ENV: "production" }).cookie.secure).toBe(true);
  });

  it("refuses a short JWT secret", () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
  });

  it("refuses an encryption key that isn't 32 bytes of hex", () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: "abc" })).toThrow(/ENCRYPTION_KEY/);
  });

  it("reads the checker settings when both are set", () => {
    const config = loadConfig({
      ...base,
      CHECKER_URL: "http://localhost:8787",
      CHECKER_HMAC_SECRET: "s".repeat(16),
    });
    expect(config.checker).toEqual({ url: "http://localhost:8787", secret: "s".repeat(16) });
  });

  it("treats empty checker settings as unset", () => {
    expect(loadConfig({ ...base, CHECKER_URL: "", CHECKER_HMAC_SECRET: "" }).checker).toBeNull();
  });

  it("refuses only one of the checker settings", () => {
    expect(() => loadConfig({ ...base, CHECKER_URL: "http://localhost:8787" })).toThrow(/both/);
  });

  it("refuses a missing database URL", () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});
