import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { PrismaClient } from "./db.js";

function fakePrisma(queryRaw: () => Promise<unknown>): PrismaClient {
  return { $queryRaw: queryRaw } as unknown as PrismaClient;
}

describe("GET /health", () => {
  it("reports ok when the database answers", async () => {
    const app = buildApp({
      prisma: fakePrisma(() => Promise.resolve([{ "?column?": 1 }])),
      version: "test",
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok", version: "test" });
  });

  it("still answers when the database is unreachable", async () => {
    const app = buildApp({
      prisma: fakePrisma(() => Promise.reject(new Error("connection refused"))),
      version: "test",
    });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ db: "error" });
  });
});
