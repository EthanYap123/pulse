import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrisma, resetDb } from "./helpers/db.js";

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedMonitor() {
  const user = await prisma.user.create({ data: { email: "a@example.com", passwordHash: "x" } });
  const project = await prisma.project.create({
    data: { ownerId: user.id, name: "Site", slug: "site" },
  });
  const monitor = await prisma.monitor.create({
    data: { projectId: project.id, name: "Home", url: "https://example.com", shard: 0 },
  });
  return { user, project, monitor };
}

describe("schema", () => {
  it("applies the documented defaults to a new monitor", async () => {
    const { monitor } = await seedMonitor();
    expect(monitor).toMatchObject({
      method: "GET",
      expectedStatusMin: 200,
      expectedStatusMax: 399,
      timeoutMs: 8000,
      failureThreshold: 3,
      isPaused: false,
      showOnStatusPage: true,
      lastStatus: "pending",
      headers: {},
    });
  });

  it("rejects an email that isn't lowercase", async () => {
    await expect(
      prisma.user.create({ data: { email: "Mixed@Example.com", passwordHash: "x" } }),
    ).rejects.toThrow(/users_email_lowercase/);
  });

  it("rejects a slug with invalid characters", async () => {
    const user = await prisma.user.create({ data: { email: "b@example.com", passwordHash: "x" } });
    await expect(
      prisma.project.create({ data: { ownerId: user.id, name: "x", slug: "Bad_Slug" } }),
    ).rejects.toThrow(/projects_slug_format/);
  });

  it("rejects out-of-range monitor settings", async () => {
    const { project } = await seedMonitor();
    const base = { projectId: project.id, name: "m", url: "https://example.com", shard: 0 };
    await expect(prisma.monitor.create({ data: { ...base, shard: 5 } })).rejects.toThrow(
      /monitors_shard/,
    );
    await expect(prisma.monitor.create({ data: { ...base, timeoutMs: 9000 } })).rejects.toThrow(
      /monitors_timeout_ms/,
    );
    await expect(
      prisma.monitor.create({ data: { ...base, expectedStatusMin: 500, expectedStatusMax: 200 } }),
    ).rejects.toThrow(/monitors_expected_status_range/);
  });

  it("deleting a user cascades to projects, monitors and check results", async () => {
    const { user, monitor } = await seedMonitor();
    await prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        checkedAt: new Date(),
        ok: true,
        statusCode: 200,
        latencyMs: 42,
      },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.monitor.count()).toBe(0);
    expect(await prisma.checkResult.count()).toBe(0);
  });

  it("keeps one check result per monitor and timestamp", async () => {
    const { monitor } = await seedMonitor();
    const checkedAt = new Date("2026-10-31T00:00:00Z");
    await prisma.checkResult.create({ data: { monitorId: monitor.id, checkedAt, ok: true } });
    await expect(
      prisma.checkResult.create({ data: { monitorId: monitor.id, checkedAt, ok: false } }),
    ).rejects.toThrow();
  });
});
