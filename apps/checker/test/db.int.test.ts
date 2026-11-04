import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectPg, type CheckerDb } from "../src/db.js";
import { checkerTestDatabaseUrl } from "./database-url.js";

const url = checkerTestDatabaseUrl();
const admin = new pg.Client({ connectionString: url });
let db: CheckerDb;

const MONITOR_A = "00000000-0000-4000-8000-00000000000a";
const MONITOR_B = "00000000-0000-4000-8000-00000000000b";
const CHANNEL_ON = "00000000-0000-4000-8000-0000000000c1";
const CHANNEL_OFF = "00000000-0000-4000-8000-0000000000c2";

beforeAll(async () => {
  await admin.connect();
  db = await connectPg(url);
});

beforeEach(async () => {
  await admin.query('TRUNCATE TABLE "users" CASCADE');
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ('c@example.com', 'x') RETURNING id`,
  );
  const { rows: projects } = await admin.query<{ id: string }>(
    `INSERT INTO projects (owner_id, name, slug) VALUES ($1, 'P', 'checker-test') RETURNING id`,
    [rows[0]!.id],
  );
  await admin.query(
    `INSERT INTO monitors (id, project_id, name, url, shard, headers, is_paused, failure_threshold)
     VALUES ($1, $3, 'A', 'https://a.example/', 2, '{"X-Key":"v1.x.y.z"}', false, 2),
            ($2, $3, 'B', 'https://b.example/', 4, '{}', true, 3)`,
    [MONITOR_A, MONITOR_B, projects[0]!.id],
  );
  await admin.query(
    `INSERT INTO alert_channels (id, project_id, type, name, secret_enc, state, cooldown_minutes)
     VALUES ($1, $3, 'discord', 'Ops', 'v1.enc.on', 'active', 10),
            ($2, $3, 'discord', 'Old', 'v1.enc.off', 'disabled', 10)`,
    [CHANNEL_ON, CHANNEL_OFF, projects[0]!.id],
  );
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

describe("CheckerDb against Postgres", () => {
  it("loads one shard's monitors in the checker's shape", async () => {
    expect(await db.loadShardMonitors(2)).toEqual([
      {
        id: MONITOR_A,
        shard: 2,
        url: "https://a.example/",
        method: "GET",
        expectedStatus: { min: 200, max: 399 },
        timeoutMs: 8000,
        failureThreshold: 2,
        encryptedHeaders: { "X-Key": "v1.x.y.z" },
        isPaused: false,
      },
    ]);
    expect(await db.loadShardMonitors(0)).toEqual([]);
  });

  it("inserts results, ignores duplicates, and skips monitors deleted since the check", async () => {
    const at = "2026-11-01T12:05:00.000Z";
    const rows = [
      {
        monitorId: MONITOR_A,
        checkedAt: at,
        ok: true,
        statusCode: 200,
        latencyMs: 42,
        error: null,
      },
      {
        monitorId: MONITOR_B,
        checkedAt: at,
        ok: false,
        statusCode: null,
        latencyMs: null,
        error: "timeout" as const,
      },
      {
        monitorId: "00000000-0000-4000-8000-0000000000ff",
        checkedAt: at,
        ok: true,
        statusCode: 200,
        latencyMs: 1,
        error: null,
      },
    ];
    await db.insertResults(rows);
    await db.insertResults(rows); // a retried flush
    const { rows: stored } = await admin.query(
      `SELECT monitor_id, ok, status_code, latency_ms, error::text FROM check_results ORDER BY monitor_id`,
    );
    expect(stored).toEqual([
      { monitor_id: MONITOR_A, ok: true, status_code: 200, latency_ms: 42, error: null },
      { monitor_id: MONITOR_B, ok: false, status_code: null, latency_ms: null, error: "timeout" },
    ]);
  });

  it("updates the last status shown when the checker is unreachable", async () => {
    await db.updateStatuses([
      { monitorId: MONITOR_A, status: "down", checkedAt: "2026-11-01T12:05:00.000Z" },
    ]);
    const { rows } = await admin.query(
      `SELECT last_status::text, last_checked_at FROM monitors WHERE id = $1`,
      [MONITOR_A],
    );
    expect(rows[0]).toEqual({
      last_status: "down",
      last_checked_at: new Date("2026-11-01T12:05:00.000Z"),
    });
  });

  it("does nothing for empty batches", async () => {
    await db.insertResults([]);
    await db.updateStatuses([]);
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM check_results`);
    expect(rows[0]).toEqual({ n: 0 });
  });
});

describe("incident events against Postgres", () => {
  const STARTED = "2026-11-01T12:00:00.000Z";

  async function incidents() {
    const { rows } = await admin.query(
      `SELECT monitor_id, started_at, resolved_at, cause::text, last_status_code, resolve_reason::text
       FROM incidents ORDER BY started_at`,
    );
    return rows;
  }

  it("opens one incident however many times the event is replayed", async () => {
    const opened = {
      type: "opened" as const,
      monitorId: MONITOR_A,
      startedAt: STARTED,
      cause: "timeout" as const,
      lastStatusCode: null,
    };
    await db.writeIncidentEvent(opened);
    await db.writeIncidentEvent(opened);
    expect(await incidents()).toEqual([
      {
        monitor_id: MONITOR_A,
        started_at: new Date(STARTED),
        resolved_at: null,
        cause: "timeout",
        last_status_code: null,
        resolve_reason: null,
      },
    ]);
  });

  it("resolves the open incident, and a later outage opens a new one", async () => {
    const open = (startedAt: string) =>
      db.writeIncidentEvent({
        type: "opened",
        monitorId: MONITOR_A,
        startedAt,
        cause: "status",
        lastStatusCode: 502,
      });
    await open(STARTED);
    const resolved = {
      type: "resolved" as const,
      monitorId: MONITOR_A,
      resolvedAt: "2026-11-01T12:20:00.000Z",
      reason: "recovered" as const,
    };
    await db.writeIncidentEvent(resolved);
    await db.writeIncidentEvent(resolved); // replay: nothing left open to resolve
    await open("2026-11-01T13:00:00.000Z");

    const rows = await incidents();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      resolved_at: new Date("2026-11-01T12:20:00.000Z"),
      resolve_reason: "recovered",
    });
    expect(rows[1]).toMatchObject({ resolved_at: null, last_status_code: 502 });
  });

  it("ignores events for a monitor deleted since the check", async () => {
    await db.writeIncidentEvent({
      type: "opened",
      monitorId: "00000000-0000-4000-8000-0000000000ff",
      startedAt: STARTED,
      cause: "dns",
      lastStatusCode: null,
    });
    expect(await incidents()).toEqual([]);
  });
});

describe("alert deliveries against Postgres", () => {
  const open = (startedAt: string) =>
    db.writeIncidentEvent({
      type: "opened",
      monitorId: MONITOR_A,
      startedAt,
      cause: "status",
      lastStatusCode: 503,
    });
  const resolve = (resolvedAt: string) =>
    db.writeIncidentEvent({
      type: "resolved",
      monitorId: MONITOR_A,
      resolvedAt,
      reason: "recovered",
    });

  async function deliveries() {
    const { rows } = await admin.query(
      `SELECT c.name, d.event::text, d.state::text FROM alert_deliveries d
       JOIN alert_channels c ON c.id = d.channel_id ORDER BY d.created_at, d.event`,
    );
    return rows;
  }

  it("queues an outage alert for each active channel and returns what the message needs", async () => {
    const jobs = await open("2026-11-01T12:00:00.000Z");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.deliveryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(jobs[0]).toMatchObject({
      channelId: CHANNEL_ON,
      channelType: "discord",
      secretEnc: "v1.enc.on",
      message: {
        event: "opened",
        projectName: "P",
        monitorName: "A",
        monitorUrl: "https://a.example/",
        startedAt: "2026-11-01T12:00:00.000Z",
        cause: "status",
        lastStatusCode: 503,
      },
    });
    expect(await deliveries()).toEqual([{ name: "Ops", event: "opened", state: "pending" }]);
  });

  it("returns nothing when the event is replayed", async () => {
    await open("2026-11-01T12:00:00.000Z");
    expect(await open("2026-11-01T12:00:00.000Z")).toEqual([]);
    expect(await deliveries()).toHaveLength(1);
  });

  it("only queues a recovery alert where the outage alert went out", async () => {
    const [opened] = await open("2026-11-01T12:00:00.000Z");
    await db.updateDeliveries([
      {
        id: opened!.deliveryId,
        state: "failed",
        attempts: 1,
        lastError: "rejected (400)",
        sentAt: null,
        nextAttemptAt: "2026-11-01T12:00:01.000Z",
      },
    ]);
    expect(await resolve("2026-11-01T12:30:00.000Z")).toEqual([]);

    // Next outage: this time the outage alert is sent, so the recovery is queued.
    const [second] = await open("2026-11-01T13:00:00.000Z");
    await db.updateDeliveries([
      {
        id: second!.deliveryId,
        state: "sent",
        attempts: 1,
        lastError: null,
        sentAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        nextAttemptAt: "2026-11-01T13:00:01.000Z",
      },
    ]);
    const [recovery] = await resolve("2026-11-01T13:20:00.000Z");
    expect(recovery?.message).toMatchObject({
      event: "resolved",
      startedAt: "2026-11-01T13:00:00.000Z",
      resolvedAt: "2026-11-01T13:20:00.000Z",
      reason: "recovered",
    });
  });

  it("suppresses an outage alert inside the channel's cooldown", async () => {
    const [first] = await open("2026-11-01T12:00:00.000Z");
    // The first outage alert was sent a minute ago (cooldown is 10 minutes).
    await db.updateDeliveries([
      {
        id: first!.deliveryId,
        state: "sent",
        attempts: 1,
        lastError: null,
        sentAt: new Date(Date.now() - 60_000).toISOString(),
        nextAttemptAt: new Date().toISOString(),
      },
    ]);
    await resolve("2026-11-01T12:05:00.000Z");
    // It flaps straight back down.
    expect(await open("2026-11-01T12:06:00.000Z")).toEqual([]);
    expect((await deliveries()).map((d) => [d.event, d.state])).toEqual([
      ["opened", "sent"],
      ["resolved", "pending"],
      ["opened", "suppressed"],
    ]);
  });

  it("disables channels", async () => {
    await db.disableChannels([{ channelId: CHANNEL_ON, reason: "webhook_deleted" }]);
    const { rows } = await admin.query(
      `SELECT state::text, disabled_reason FROM alert_channels WHERE id = $1`,
      [CHANNEL_ON],
    );
    expect(rows[0]).toEqual({ state: "disabled", disabled_reason: "webhook_deleted" });
    expect(await open("2026-11-01T12:00:00.000Z")).toEqual([]);
  });

  it("does nothing for empty batches", async () => {
    await db.updateDeliveries([]);
    await db.disableChannels([]);
  });
});

describe("status page data against Postgres", () => {
  it("includes public projects and shown monitors only", async () => {
    await admin.query(`UPDATE monitors SET show_on_status_page = false WHERE id = $1`, [MONITOR_B]);
    const data = await db.loadStatusData(null);
    expect(data.monitors.map((m) => [m.slug, m.monitorId])).toEqual([["checker-test", MONITOR_A]]);

    await admin.query(`UPDATE projects SET is_public = false`);
    expect((await db.loadStatusData(null)).monitors).toEqual([]);
  });

  it("keeps a public project with nothing shown", async () => {
    await admin.query(`UPDATE monitors SET show_on_status_page = false`);
    const data = await db.loadStatusData(null);
    expect(data.monitors).toMatchObject([{ slug: "checker-test", monitorId: null, shard: null }]);
  });

  it("groups checks by UTC day and leaves out hidden monitors", async () => {
    const recent = new Date(Date.UTC(2026, 10, 1, 23, 59)).toISOString();
    const nextDay = new Date(Date.UTC(2026, 10, 2, 0, 1)).toISOString();
    await admin.query(`UPDATE monitors SET show_on_status_page = false WHERE id = $1`, [MONITOR_B]);
    await db.insertResults([
      {
        monitorId: MONITOR_A,
        checkedAt: recent,
        ok: true,
        statusCode: 200,
        latencyMs: 1,
        error: null,
      },
      {
        monitorId: MONITOR_A,
        checkedAt: nextDay,
        ok: false,
        statusCode: 500,
        latencyMs: 1,
        error: "status",
      },
      {
        monitorId: MONITOR_B,
        checkedAt: nextDay,
        ok: true,
        statusCode: 200,
        latencyMs: 1,
        error: null,
      },
    ]);
    const { days } = await db.loadStatusData(null);
    const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
    expect(sorted).toEqual([
      { monitorId: MONITOR_A, day: "2026-11-01", checks: 1, failures: 0 },
      { monitorId: MONITOR_A, day: "2026-11-02", checks: 1, failures: 1 },
    ]);
  });

  it("lists open incidents and those from the last 14 days, newest first", async () => {
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    for (const [start, end] of [
      [daysAgo(20), daysAgo(19)], // too old
      [daysAgo(5), daysAgo(4)],
    ] as const) {
      await admin.query(
        `INSERT INTO incidents (monitor_id, started_at, resolved_at, cause, resolve_reason)
         VALUES ($1, $2, $3, 'timeout', 'recovered')`,
        [MONITOR_A, start, end],
      );
    }
    await admin.query(
      `INSERT INTO incidents (monitor_id, started_at, cause, note) VALUES ($1, $2, 'dns', 'Looking into it')`,
      [MONITOR_A, daysAgo(30)], // old, but still open
    );
    const { incidents } = await db.loadStatusData(null);
    expect(incidents.map((i) => i.resolvedAt === null)).toEqual([false, true]);
    expect(incidents[1]?.note).toBe("Looking into it");
  });

  it("can load just some projects, and finds a monitor's project", async () => {
    const [projectId] = await db.projectIdsForMonitors([MONITOR_A, MONITOR_B]);
    expect((await db.loadStatusData([projectId!])).monitors).toHaveLength(2);
    expect((await db.loadStatusData(["00000000-0000-4000-8000-0000000000ee"])).monitors).toEqual(
      [],
    );
  });
});
