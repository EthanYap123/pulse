import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectPg, type CheckerDb } from "../src/db.js";
import { checkerTestDatabaseUrl } from "./database-url.js";

const url = checkerTestDatabaseUrl();
const admin = new pg.Client({ connectionString: url });
let db: CheckerDb;

const M = "00000000-0000-4000-8000-00000000000a";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The start of the UTC hour `n` hours ago, as a timestamp. */
const hoursAgo = (n: number) => Math.floor(Date.now() / HOUR) * HOUR - n * HOUR;
const iso = (t: number) => new Date(t).toISOString();

beforeAll(async () => {
  await admin.connect();
  db = await connectPg(url);
});

beforeEach(async () => {
  await admin.query('TRUNCATE TABLE "users" CASCADE');
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ('r@example.com', 'x') RETURNING id`,
  );
  const { rows: projects } = await admin.query<{ id: string }>(
    `INSERT INTO projects (owner_id, name, slug) VALUES ($1, 'P', 'rollup-test') RETURNING id`,
    [rows[0]!.id],
  );
  await admin.query(
    `INSERT INTO monitors (id, project_id, name, url, shard) VALUES ($1, $2, 'A', 'https://a.example/', 0)`,
    [M, projects[0]!.id],
  );
});

afterAll(async () => {
  await db.close();
  await admin.end();
});

async function check(at: number, ok: boolean, latencyMs: number | null = 100) {
  await admin.query(
    `INSERT INTO check_results (monitor_id, checked_at, ok, status_code, latency_ms, error)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [M, iso(at), ok, ok ? 200 : 503, latencyMs, ok ? null : "status"],
  );
}

async function hourly() {
  const { rows } = await admin.query<Record<string, unknown>>(
    `SELECT hour, checks, failures, latency_avg_ms, latency_p95_ms, latency_max_ms
     FROM check_rollups_hourly ORDER BY hour`,
  );
  return rows;
}

async function count(table: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

describe("hourly rollups", () => {
  it("summarises a complete hour, with latency from successful checks only", async () => {
    const h = hoursAgo(2);
    await check(h + 60_000, true, 100);
    await check(h + 120_000, true, 300);
    await check(h + 180_000, false, 9000); // a slow failure mustn't skew the latency figures
    const result = await db.rollUpHours();
    expect(result.hours).toBe(1);
    expect(result.oldest).toBe(iso(h));
    expect(await hourly()).toEqual([
      {
        hour: new Date(h),
        checks: 3,
        failures: 1,
        latency_avg_ms: 200,
        latency_p95_ms: 290,
        latency_max_ms: 300,
      },
    ]);
  });

  it("leaves the current hour alone until it is complete", async () => {
    await check(hoursAgo(0) + 1, true);
    expect((await db.rollUpHours()).hours).toBe(0);
  });

  it("has no latency for an hour where every check failed", async () => {
    await check(hoursAgo(1) + 1, false, null);
    await db.rollUpHours();
    expect((await hourly())[0]).toMatchObject({ checks: 1, failures: 1, latency_avg_ms: null });
  });

  it("does nothing on a repeat run", async () => {
    await check(hoursAgo(1) + 1, true);
    await db.rollUpHours();
    expect(await db.rollUpHours()).toEqual({ hours: 0, oldest: null });
  });

  it("rebuilds an hour when late results arrive after a failed flush", async () => {
    const h = hoursAgo(5);
    await check(h + 1, true);
    await db.rollUpHours();
    await check(h + 2, false);
    expect((await db.rollUpHours()).oldest).toBe(iso(h));
    expect((await hourly())[0]).toMatchObject({ checks: 2, failures: 1 });
  });
});

describe("daily rollups", () => {
  async function seedHourly(
    at: number,
    checks: number,
    failures: number,
    avg: number,
    p95: number,
  ) {
    await admin.query(
      `INSERT INTO check_rollups_hourly (monitor_id, hour, checks, failures, latency_avg_ms, latency_p95_ms, latency_max_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [M, iso(at), checks, failures, avg, p95],
    );
  }

  it("adds up hours into UTC days, weighting latency by successful checks", async () => {
    const day = Date.UTC(2026, 10, 3);
    await seedHourly(day + 23 * HOUR, 10, 0, 100, 150);
    await seedHourly(day + 22 * HOUR, 10, 8, 200, 400); // only 2 successes, so little weight
    await seedHourly(day + 24 * HOUR, 12, 0, 50, 60); // the next UTC day
    await db.rollUpDays(iso(day));
    const { rows } = await admin.query(
      `SELECT day::text, checks, failures, latency_avg_ms, latency_p95_ms FROM check_rollups_daily ORDER BY day`,
    );
    expect(rows).toEqual([
      { day: "2026-11-03", checks: 20, failures: 8, latency_avg_ms: 117, latency_p95_ms: 400 },
      { day: "2026-11-04", checks: 12, failures: 0, latency_avg_ms: 50, latency_p95_ms: 60 },
    ]);
  });

  it("updates a day as more hours complete, and leaves days before the window alone", async () => {
    const day = Date.UTC(2026, 10, 3);
    await seedHourly(day - HOUR, 5, 0, 100, 100);
    await seedHourly(day, 5, 0, 100, 100);
    await db.rollUpDays(iso(day - DAY));
    await seedHourly(day + HOUR, 5, 5, 100, 100);
    await admin.query(`DELETE FROM check_rollups_hourly WHERE hour < $1`, [iso(day)]);
    await db.rollUpDays(iso(day));
    const { rows } = await admin.query(
      `SELECT day::text, checks, failures FROM check_rollups_daily ORDER BY day`,
    );
    expect(rows).toEqual([
      { day: "2026-11-02", checks: 5, failures: 0 }, // hourly data gone, figure untouched
      { day: "2026-11-03", checks: 10, failures: 5 },
    ]);
  });
});

describe("retention", () => {
  it("deletes raw checks past 7 days once they are rolled up, and keeps the rest", async () => {
    const old = hoursAgo(9 * 24);
    await check(old + 1, true);
    await check(hoursAgo(3) + 1, true);
    await db.rollUpHours();
    expect(await db.applyRetention()).toMatchObject({ raw: 1 });
    expect(await count("check_results")).toBe(1);
    expect(await count("check_rollups_hourly")).toBe(2); // the summary outlives the raw check
  });

  it("never deletes raw checks that have no rollup yet", async () => {
    await check(hoursAgo(9 * 24) + 1, true);
    expect(await db.applyRetention()).toMatchObject({ raw: 0 });
    expect(await count("check_results")).toBe(1);
  });

  it("deletes whole hours, so a later run can't rebuild a rollup from part of one", async () => {
    const h = hoursAgo(9 * 24);
    await check(h + 1, true);
    await check(h + 2, false);
    await db.rollUpHours();
    await db.applyRetention();
    expect(await count("check_results")).toBe(0);
    await db.rollUpHours();
    expect((await hourly())[0]).toMatchObject({ checks: 2, failures: 1 });
  });

  it("catches up 24 hours at a time after a long gap", async () => {
    const start = hoursAgo(20 * 24);
    for (let i = 0; i < 3; i++) await check(start + i * 20 * HOUR + 1, true);
    await db.rollUpHours();
    expect(await db.applyRetention()).toMatchObject({ raw: 2 }); // hours 0 and 20, not hour 40
    expect(await db.applyRetention()).toMatchObject({ raw: 1 });
  });

  it("deletes hourly rollups past 30 days and daily rollups past 400", async () => {
    await admin.query(
      `INSERT INTO check_rollups_hourly (monitor_id, hour, checks, failures)
       VALUES ($1, $2, 1, 0), ($1, $3, 1, 0)`,
      [M, iso(hoursAgo(31 * 24)), iso(hoursAgo(29 * 24))],
    );
    await admin.query(
      `INSERT INTO check_rollups_daily (monitor_id, day, checks, failures)
       VALUES ($1, $2, 1, 0), ($1, $3, 1, 0)`,
      [M, iso(Date.now() - 401 * DAY).slice(0, 10), iso(Date.now() - 399 * DAY).slice(0, 10)],
    );
    expect(await db.applyRetention()).toMatchObject({ hourly: 1, daily: 1 });
    expect(await count("check_rollups_hourly")).toBe(1);
    expect(await count("check_rollups_daily")).toBe(1);
  });

  it("deletes incidents resolved over 400 days ago, but never an open one", async () => {
    const at = (days: number) => iso(Date.now() - days * DAY);
    await admin.query(
      `INSERT INTO incidents (monitor_id, started_at, resolved_at, cause, resolve_reason) VALUES
       ($1, $2, $3, 'dns', 'recovered'), ($1, $4, $5, 'dns', 'recovered')`,
      [M, at(500), at(499), at(300), at(299)],
    );
    await admin.query(
      `INSERT INTO incidents (monitor_id, started_at, cause) VALUES ($1, $2, 'dns')`,
      [M, at(600)],
    );
    expect(await db.applyRetention()).toMatchObject({ incidents: 1 });
    expect(await count("incidents")).toBe(2);
  });
});
