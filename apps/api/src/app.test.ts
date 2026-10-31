import { describe, expect, it, vi } from "vitest";
import { testConfig } from "../test/helpers/config.js";
import { buildApp } from "./app.js";
import type { PrismaClient } from "./db.js";

function fakePrisma(queryRaw: () => Promise<unknown>): PrismaClient {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

describe("GET /health", () => {
  it("answers without querying the database", async () => {
    const queryRaw = vi.fn(() => Promise.resolve([]));
    const app = buildApp({ prisma: fakePrisma(queryRaw), config: testConfig });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "test" });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("GET /health/db", () => {
  it("reports ok when the database answers", async () => {
    const app = buildApp({
      prisma: fakePrisma(() => Promise.resolve([{ "?column?": 1 }])),
      config: testConfig,
    });
    const res = await app.inject({ method: "GET", url: "/health/db" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok", version: "test" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = buildApp({
      prisma: fakePrisma(() => Promise.reject(new Error("connection refused"))),
      config: testConfig,
    });
    const res = await app.inject({ method: "GET", url: "/health/db" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", db: "error", version: "test" });
  });
});

describe("error responses", () => {
  const app = buildApp({ prisma: fakePrisma(() => Promise.resolve([])), config: testConfig });

  it("returns problem details for unknown routes", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 404, code: "not_found" });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad_request" });
  });

  it("returns 422 with field errors when validation fails", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "not-an-email", password: "short" },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ code: string; errors: { path: string }[] }>();
    expect(body.code).toBe("validation_failed");
    expect(body.errors.map((e) => e.path).sort()).toEqual(["email", "password"]);
  });

  it("rejects protected routes without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "unauthenticated" });
  });
});
