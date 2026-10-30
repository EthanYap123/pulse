import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPrisma } from "../src/db.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Integration tests need DATABASE_URL (see apps/api/.env.example)");
}

const prisma = createPrisma(databaseUrl);
const app = buildApp({ prisma, version: "test" });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /health against Postgres", () => {
  it("reaches the real database", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ status: "ok", db: "ok", version: "test" });
  });
});
