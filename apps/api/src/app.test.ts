import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { PrismaClient } from "./db.js";

function fakePrisma(queryRaw: () => Promise<unknown>): PrismaClient {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

describe("GET /health", () => {
  it("answers without querying the database", async () => {
    const queryRaw = vi.fn(() => Promise.resolve([]));
    const app = buildApp({ prisma: fakePrisma(queryRaw), version: "test" });
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
      version: "test",
    });
    const res = await app.inject({ method: "GET", url: "/health/db" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok", version: "test" });
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = buildApp({
      prisma: fakePrisma(() => Promise.reject(new Error("connection refused"))),
      version: "test",
    });
    const res = await app.inject({ method: "GET", url: "/health/db" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "error", db: "error", version: "test" });
  });
});
