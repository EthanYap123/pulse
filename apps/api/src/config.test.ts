import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5434/pulse",
  JWT_SECRET: "x".repeat(32),
};

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(base)).toEqual({
      databaseUrl: base.DATABASE_URL,
      jwtSecret: base.JWT_SECRET,
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

  it("refuses a missing database URL", () => {
    expect(() => loadConfig({ JWT_SECRET: base.JWT_SECRET })).toThrow(/DATABASE_URL/);
  });
});
