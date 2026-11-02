import type { CheckError, CheckerMonitor } from "@pulse/shared";
import type { CheckResult } from "./run-checks.js";

/** A state change that must reach Postgres straight away (docs/ARCHITECTURE.md §3.4). */
export type IncidentEvent =
  | {
      type: "opened";
      monitorId: string;
      startedAt: string;
      cause: CheckError;
      lastStatusCode: number | null;
    }
  | { type: "resolved"; monitorId: string; resolvedAt: string; reason: "recovered" | "paused" };

/**
 * Every query the checker makes to Postgres. Two drivers run the same SQL: Neon's HTTP
 * driver in Cloudflare, node-postgres locally and in tests (docs/ARCHITECTURE.md §5).
 */
export interface CheckerDb {
  /** Inserts results, skipping monitors deleted since the check. Safe to retry. */
  insertResults(rows: CheckResult[]): Promise<void>;
  updateStatuses(rows: { monitorId: string; status: string; checkedAt: string }[]): Promise<void>;
  loadShardMonitors(shard: number): Promise<CheckerMonitor[]>;
  /** Opens or resolves an incident. Idempotent: replaying an event changes nothing. */
  writeIncidentEvent(event: IncidentEvent): Promise<void>;
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

// ON CONFLICT targets the partial unique index "one open incident per monitor", so a second
// "opened" for the same outage is a no-op. EXISTS skips monitors deleted since the check.
const OPEN_INCIDENT = `
INSERT INTO incidents (monitor_id, started_at, cause, last_status_code)
SELECT $1::uuid, $2::timestamptz, $3::check_error, $4::smallint
WHERE EXISTS (SELECT 1 FROM monitors WHERE id = $1::uuid)
ON CONFLICT (monitor_id) WHERE resolved_at IS NULL DO NOTHING`;

const RESOLVE_INCIDENT = `
UPDATE incidents
SET resolved_at = greatest($2::timestamptz, started_at), resolve_reason = $3::resolve_reason
WHERE monitor_id = $1::uuid AND resolved_at IS NULL`;

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

    async writeIncidentEvent(event) {
      if (event.type === "opened") {
        await query(OPEN_INCIDENT, [
          event.monitorId,
          event.startedAt,
          event.cause,
          event.lastStatusCode,
        ]);
      } else {
        await query(RESOLVE_INCIDENT, [event.monitorId, event.resolvedAt, event.reason]);
      }
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
