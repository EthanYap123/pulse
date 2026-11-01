import type { CheckerMonitor } from "@pulse/shared";
import type { CheckResult } from "./run-checks.js";

/**
 * Every query the checker makes to Postgres. Two drivers run the same SQL: Neon's HTTP
 * driver in Cloudflare, node-postgres locally and in tests (docs/ARCHITECTURE.md §5).
 */
export interface CheckerDb {
  /** Inserts results, skipping monitors deleted since the check. Safe to retry. */
  insertResults(rows: CheckResult[]): Promise<void>;
  updateStatuses(rows: { monitorId: string; status: string; checkedAt: string }[]): Promise<void>;
  loadShardMonitors(shard: number): Promise<CheckerMonitor[]>;
  close(): Promise<void>;
}

export type Query = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

const INSERT_RESULTS = `
INSERT INTO check_results (monitor_id, checked_at, ok, status_code, latency_ms, error)
SELECT u.monitor_id, u.checked_at, u.ok, u.status_code, u.latency_ms, u.error::check_error
FROM unnest($1::uuid[], $2::timestamptz[], $3::boolean[], $4::smallint[], $5::integer[], $6::text[])
  AS u(monitor_id, checked_at, ok, status_code, latency_ms, error)
JOIN monitors m ON m.id = u.monitor_id
ON CONFLICT (monitor_id, checked_at) DO NOTHING`;

const UPDATE_STATUSES = `
UPDATE monitors
SET last_status = u.status::monitor_status, last_checked_at = u.checked_at
FROM unnest($1::uuid[], $2::text[], $3::timestamptz[]) AS u(id, status, checked_at)
WHERE monitors.id = u.id`;

const LOAD_SHARD = `
SELECT id, shard, url, method::text AS method, expected_status_min, expected_status_max,
       timeout_ms, failure_threshold, headers, is_paused
FROM monitors
WHERE shard = $1
ORDER BY id`;

export function createCheckerDb(query: Query, close: () => Promise<void>): CheckerDb {
  return {
    async insertResults(rows) {
      if (rows.length === 0) return;
      await query(INSERT_RESULTS, [
        rows.map((r) => r.monitorId),
        rows.map((r) => r.checkedAt),
        rows.map((r) => r.ok),
        rows.map((r) => r.statusCode),
        rows.map((r) => r.latencyMs),
        rows.map((r) => r.error),
      ]);
    },

    async updateStatuses(rows) {
      if (rows.length === 0) return;
      await query(UPDATE_STATUSES, [
        rows.map((r) => r.monitorId),
        rows.map((r) => r.status),
        rows.map((r) => r.checkedAt),
      ]);
    },

    async loadShardMonitors(shard) {
      const rows = await query(LOAD_SHARD, [shard]);
      return rows.map((r) => ({
        id: String(r.id),
        shard: Number(r.shard),
        url: String(r.url),
        method: r.method === "HEAD" ? "HEAD" : "GET",
        expectedStatus: { min: Number(r.expected_status_min), max: Number(r.expected_status_max) },
        timeoutMs: Number(r.timeout_ms),
        failureThreshold: Number(r.failure_threshold),
        encryptedHeaders: (r.headers ?? {}) as Record<string, string>,
        isPaused: Boolean(r.is_paused),
      }));
    },

    close,
  };
}

/** node-postgres over TCP. Works in Node and, with `nodejs_compat`, in workerd. */
export async function connectPg(connectionString: string): Promise<CheckerDb> {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString });
  await client.connect();
  return createCheckerDb(
    async (text, params) => (await client.query(text, params)).rows,
    () => client.end(),
  );
}

/** Neon's HTTP driver: one HTTPS request per query, no connection to keep open. */
export async function connectNeon(connectionString: string): Promise<CheckerDb> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(connectionString);
  return createCheckerDb(
    (text, params) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
    () => Promise.resolve(),
  );
}

export function connectDb(
  driver: string | undefined,
  connectionString: string,
): Promise<CheckerDb> {
  return driver === "pg" ? connectPg(connectionString) : connectNeon(connectionString);
}
