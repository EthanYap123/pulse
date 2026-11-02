import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectPg, type CheckerDb } from "../src/db.js";
import { checkerTestDatabaseUrl } from "./database-url.js";

const url = checkerTestDatabaseUrl();
const admin = new pg.Client({ connectionString: url });
let db: CheckerDb;

const MONITOR_A = "00000000-0000-4000-8000-00000000000a";
const MONITOR_B = "00000000-0000-4000-8000-00000000000b";

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
