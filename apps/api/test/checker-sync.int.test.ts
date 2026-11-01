import type { CheckerMonitor, LiveStatus } from "@pulse/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { CheckerClient } from "../src/checker-client.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma, resetDb } from "./helpers/db.js";
import { signUp, type Session } from "./helpers/session.js";

/** Records what the API tells the checker and answers live-status calls from a map. */
function fakeChecker() {
  const synced: CheckerMonitor[] = [];
  const removed: { id: string; shard: number }[] = [];
  const live = new Map<string, LiveStatus>();
  let reachable = true;
  const client: CheckerClient = {
    sync: (m) => {
      synced.push(m);
      return Promise.resolve(reachable);
    },
    remove: (id, shard) => {
      removed.push({ id, shard });
      return Promise.resolve(reachable);
    },
    live: (monitors) =>
      Promise.resolve(
        reachable
          ? new Map(monitors.flatMap((m) => (live.has(m.id) ? [[m.id, live.get(m.id)!]] : [])))
          : null,
      ),
  };
  return {
    client,
    synced,
    removed,
    live,
    setReachable: (value: boolean) => {
      reachable = value;
    },
  };
}

const prisma = createTestPrisma();
const checker = fakeChecker();
const app = buildApp({ prisma, config: testConfig, checker: checker.client });

let alice: Session;
let projectId: string;

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(prisma);
  checker.synced.length = 0;
  checker.removed.length = 0;
  checker.live.clear();
  checker.setReachable(true);
  alice = await signUp(app, "alice@example.com");
  const res = await alice.request({
    method: "POST",
    url: "/v1/projects",
    payload: { name: "Alice", slug: "alice" },
  });
  projectId = res.json<{ id: string }>().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function createMonitor(payload: Record<string, unknown> = {}) {
  const res = await alice.request({
    method: "POST",
    url: `/v1/projects/${projectId}/monitors`,
    payload: { name: "Home", url: "https://example.com", ...payload },
  });
  return res.json<{ id: string; status: string; statusSource: string }>();
}

describe("syncing monitors to the checker", () => {
  it("sends the stored config, with header values still encrypted, on create", async () => {
    const { id } = await createMonitor({ headers: { "X-Key": "secret-value" } });
    const row = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(checker.synced).toEqual([
      {
        id,
        shard: row.shard,
        url: "https://example.com/",
        method: "GET",
        expectedStatus: { min: 200, max: 399 },
        timeoutMs: 8000,
        failureThreshold: 3,
        encryptedHeaders: row.headers,
        isPaused: false,
      },
    ]);
    expect(JSON.stringify(checker.synced)).not.toContain("secret-value");
  });

  it("syncs again on update, pause and resume", async () => {
    const { id } = await createMonitor();
    await alice.request({
      method: "PATCH",
      url: `/v1/monitors/${id}`,
      payload: { timeoutMs: 3000 },
    });
    await alice.request({ method: "POST", url: `/v1/monitors/${id}/pause` });
    await alice.request({ method: "POST", url: `/v1/monitors/${id}/resume` });
    expect(checker.synced.map((m) => [m.timeoutMs, m.isPaused])).toEqual([
      [8000, false],
      [3000, false],
      [3000, true],
      [3000, false],
    ]);
  });

  it("tells the checker to drop a deleted monitor, and every monitor of a deleted project", async () => {
    const first = await createMonitor();
    const second = await createMonitor({ name: "Two" });
    const shards = await prisma.monitor.findMany({ select: { id: true, shard: true } });

    await alice.request({ method: "DELETE", url: `/v1/monitors/${first.id}` });
    expect(checker.removed).toEqual([shards.find((s) => s.id === first.id)]);

    await alice.request({ method: "DELETE", url: `/v1/projects/${projectId}` });
    expect(checker.removed).toContainEqual(shards.find((s) => s.id === second.id));
  });

  it("still succeeds when the checker is unreachable", async () => {
    checker.setReachable(false);
    const res = await alice.request({
      method: "POST",
      url: `/v1/projects/${projectId}/monitors`,
      payload: { name: "Home", url: "https://example.com" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("live status", () => {
  it("uses the checker's status when it answers", async () => {
    const { id } = await createMonitor();
    checker.live.set(id, {
      monitorId: id,
      status: "down",
      lastCheckedAt: "2026-11-01T12:05:00.000Z",
      lastLatencyMs: null,
    });
    const res = await alice.request({ method: "GET", url: `/v1/projects/${projectId}/monitors` });
    expect(res.json<{ items: unknown[] }>().items[0]).toMatchObject({
      status: "down",
      statusSource: "live",
      lastCheckedAt: "2026-11-01T12:05:00.000Z",
    });
  });

  it("falls back to the last stored status when the checker is down", async () => {
    const { id } = await createMonitor();
    await prisma.monitor.update({ where: { id }, data: { lastStatus: "up" } });
    checker.setReachable(false);
    const res = await alice.request({ method: "GET", url: `/v1/monitors/${id}` });
    expect(res.json()).toMatchObject({
      status: "up",
      statusSource: "last_flush",
      lastLatencyMs: null,
    });
  });
});

describe("GET /v1/monitors/:id/checks", () => {
  async function seedChecks(id: string) {
    const now = Date.now();
    const minutesAgo = (m: number) => new Date(now - m * 60_000);
    await prisma.checkResult.createMany({
      data: [
        { monitorId: id, checkedAt: minutesAgo(10), ok: true, statusCode: 200, latencyMs: 100 },
        { monitorId: id, checkedAt: minutesAgo(5), ok: false, statusCode: 503, latencyMs: 40 },
        { monitorId: id, checkedAt: minutesAgo(0), ok: true, statusCode: 200, latencyMs: 300 },
        // Two days ago: outside 24h, inside 7d.
        {
          monitorId: id,
          checkedAt: minutesAgo(2 * 24 * 60),
          ok: true,
          statusCode: 200,
          latencyMs: 200,
        },
      ],
    });
  }

  it("returns every check from the last 24 hours with uptime", async () => {
    const { id } = await createMonitor();
    await seedChecks(id);
    const res = await alice.request({ method: "GET", url: `/v1/monitors/${id}/checks?range=24h` });
    const body = res.json<{ points: { ok: boolean; latencyMs: number }[]; uptimePct: number }>();
    expect(body.points.map((p) => [p.ok, p.latencyMs])).toEqual([
      [true, 100],
      [false, 40],
      [true, 300],
    ]);
    expect(body.uptimePct).toBe(66.67);
  });

  it("returns hourly buckets for 7 days, averaging only successful checks", async () => {
    const { id } = await createMonitor();
    await seedChecks(id);
    const res = await alice.request({ method: "GET", url: `/v1/monitors/${id}/checks?range=7d` });
    const body = res.json<{
      points: { checks: number; failures: number; avgMs: number }[];
      uptimePct: number;
    }>();
    const total = body.points.reduce((n, p) => n + p.checks, 0);
    expect(total).toBe(4);
    expect(body.uptimePct).toBe(75);
    for (const p of body.points) expect(p.avgMs).not.toBe(40); // the failed check is excluded
  });

  it("returns empty history with null uptime for a new monitor", async () => {
    const { id } = await createMonitor();
    const res = await alice.request({ method: "GET", url: `/v1/monitors/${id}/checks` });
    expect(res.json()).toEqual({ range: "24h", points: [], uptimePct: null });
  });

  it("is hidden from other users and rejects unknown ranges", async () => {
    const { id } = await createMonitor();
    const bob = await signUp(app, "bob@example.com");
    expect(
      (await bob.request({ method: "GET", url: `/v1/monitors/${id}/checks` })).statusCode,
    ).toBe(404);
    expect(
      (await alice.request({ method: "GET", url: `/v1/monitors/${id}/checks?range=1y` }))
        .statusCode,
    ).toBe(422);
  });
});
