import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma } from "./helpers/db.js";

const prisma = createTestPrisma();
const app = buildApp({ prisma, config: testConfig });

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("GET /health/db against Postgres", () => {
  it("reaches the real database", async () => {
    const res = await app.inject({ method: "GET", url: "/health/db" });
    expect(res.json()).toEqual({ status: "ok", db: "ok", version: "test" });
  });
});
