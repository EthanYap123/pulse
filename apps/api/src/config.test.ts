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
      cookie: { path: "/api/v1/auth", secure: false },
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

  it("refuses a missing database URL", () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
});
