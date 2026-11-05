import {
  RETENTION_DAYS,
  STATUS_PAGE_DAYS,
  STATUS_PAGE_INCIDENT_DAYS,
  type AlertMessage,
  type CheckError,
  type CheckerMonitor,
} from "@pulse/shared";
import type { CheckResult } from "./run-checks.js";
import type { StatusData } from "./status.js";

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

/** One alert to send: a pending row in alert_deliveries plus everything the message needs. */
export type AlertJob = {
  deliveryId: string;
  incidentId: string;
  channelId: string;
  channelType: "discord" | "telegram";
  /** The webhook URL (or Telegram chat id), still encrypted. */
  secretEnc: string;
  message: AlertMessage;
};

export type DeliveryUpdate = {
  id: string;
  state: "pending" | "sent" | "failed";
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  nextAttemptAt: string;
};

/**
 * Every query the checker makes to Postgres. Two drivers run the same SQL: Neon's HTTP
 * driver in Cloudflare, node-postgres locally and in tests (docs/ARCHITECTURE.md §5).
 */
export interface CheckerDb {
  /** Inserts results, skipping monitors deleted since the check. Safe to retry. */
  insertResults(rows: CheckResult[]): Promise<void>;
  updateStatuses(rows: { monitorId: string; status: string; checkedAt: string }[]): Promise<void>;
  loadShardMonitors(shard: number): Promise<CheckerMonitor[]>;
  /**
   * Opens or resolves an incident and creates its alert deliveries in the same statement.
   * Returns the deliveries to send. Idempotent: replaying an event changes nothing and
   * returns nothing.
   */
  writeIncidentEvent(event: IncidentEvent): Promise<AlertJob[]>;
  updateDeliveries(rows: DeliveryUpdate[]): Promise<void>;
  disableChannels(rows: { channelId: string; reason: string }[]): Promise<void>;
  /** Status page data for public projects: all of them, or just `projectIds`. */
  loadStatusData(projectIds: string[] | null): Promise<StatusData>;
  projectIdsForMonitors(monitorIds: string[]): Promise<string[]>;
  /** Builds hourly rollups for complete hours whose raw checks changed. */
  rollUpHours(): Promise<{ hours: number; oldest: string | null }>;
  /** Recomputes daily rollups from the hourly ones, from this UTC day onwards. */
  rollUpDays(fromIso: string): Promise<void>;
  /** Deletes history past its retention. Raw checks only go once they are rolled up. */
  applyRetention(): Promise<{ raw: number; hourly: number; daily: number; incidents: number }>;
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

const MONITOR_CTE = `
m AS (
  SELECT mo.id, mo.name, mo.url, mo.project_id, p.name AS project_name
  FROM monitors mo JOIN projects p ON p.id = mo.project_id
  WHERE mo.id = $1::uuid
)`;

const JOB_COLUMNS = `
ins.id AS delivery_id, ins.incident_id, c.id AS channel_id, c.type::text AS channel_type,
c.secret_enc, m.name AS monitor_name, m.url AS monitor_url, m.project_name`;

// Opens the incident (a no-op if one is already open, thanks to the partial unique index;
// a deleted monitor matches no row in m) and queues an "opened" delivery for each active
// channel of the project. A channel that was sent an "opened" alert for this monitor within
// its cooldown gets a "suppressed" row instead, which stops flapping services spamming it.
const OPEN_INCIDENT = `
WITH ${MONITOR_CTE},
inc AS (
  INSERT INTO incidents (monitor_id, started_at, cause, last_status_code)
  SELECT m.id, $2::timestamptz, $3::check_error, $4::smallint FROM m
  ON CONFLICT (monitor_id) WHERE resolved_at IS NULL DO NOTHING
  RETURNING id, started_at, cause, last_status_code
),
ins AS (
  INSERT INTO alert_deliveries (incident_id, channel_id, event, state)
  SELECT inc.id, c.id, 'opened',
         CASE WHEN EXISTS (
           SELECT 1 FROM alert_deliveries d JOIN incidents prev ON prev.id = d.incident_id
           WHERE d.channel_id = c.id AND d.event = 'opened' AND d.state = 'sent'
             AND prev.monitor_id = m.id
             AND d.sent_at > now() - make_interval(mins => c.cooldown_minutes::int)
         ) THEN 'suppressed'::delivery_state ELSE 'pending'::delivery_state END
  FROM inc CROSS JOIN m
  JOIN alert_channels c ON c.project_id = m.project_id AND c.state = 'active'
  ON CONFLICT (incident_id, channel_id, event) DO NOTHING
  RETURNING id, incident_id, channel_id, state
)
SELECT ${JOB_COLUMNS}, inc.started_at, NULL::timestamptz AS resolved_at,
       inc.cause::text AS cause, inc.last_status_code
FROM ins JOIN alert_channels c ON c.id = ins.channel_id CROSS JOIN m CROSS JOIN inc
WHERE ins.state = 'pending'`;

// Resolves the open incident and queues a "resolved" delivery only for channels whose
// "opened" alert went out (or is still going out): no recovery message without an outage one.
const RESOLVE_INCIDENT = `
WITH ${MONITOR_CTE},
inc AS (
  UPDATE incidents
  SET resolved_at = greatest($2::timestamptz, started_at), resolve_reason = $3::resolve_reason
  WHERE monitor_id = $1::uuid AND resolved_at IS NULL
  RETURNING id, started_at, resolved_at
),
ins AS (
  INSERT INTO alert_deliveries (incident_id, channel_id, event, state)
  SELECT inc.id, d.channel_id, 'resolved', 'pending'
  FROM inc
  JOIN alert_deliveries d
    ON d.incident_id = inc.id AND d.event = 'opened' AND d.state IN ('pending', 'sent')
  JOIN alert_channels c ON c.id = d.channel_id AND c.state = 'active'
  ON CONFLICT (incident_id, channel_id, event) DO NOTHING
  RETURNING id, incident_id, channel_id
)
SELECT ${JOB_COLUMNS}, inc.started_at, inc.resolved_at,
       NULL::text AS cause, NULL::smallint AS last_status_code
FROM ins JOIN alert_channels c ON c.id = ins.channel_id CROSS JOIN m CROSS JOIN inc`;

const UPDATE_DELIVERIES = `
UPDATE alert_deliveries d
SET state = u.state::delivery_state, attempts = u.attempts, last_error = u.last_error,
    sent_at = u.sent_at, next_attempt_at = u.next_attempt_at
FROM unnest($1::uuid[], $2::text[], $3::smallint[], $4::text[], $5::timestamptz[], $6::timestamptz[])
  AS u(id, state, attempts, last_error, sent_at, next_attempt_at)
WHERE d.id = u.id`;

const DISABLE_CHANNELS = `
UPDATE alert_channels
SET state = 'disabled', disabled_reason = u.reason
FROM unnest($1::uuid[], $2::text[]) AS u(id, reason)
WHERE alert_channels.id = u.id`;

const PUBLIC_MONITORS = `
JOIN monitors m ON m.id = source.monitor_id AND m.show_on_status_page
JOIN projects p ON p.id = m.project_id AND p.is_public
  AND ($1::uuid[] IS NULL OR p.id = ANY($1::uuid[]))`;

const STATUS_MONITORS = `
SELECT p.id AS project_id, p.name AS project_name, p.slug, p.status_note,
       m.id AS monitor_id, m.name AS monitor_name, m.shard,
       coalesce(m.is_paused, false) AS is_paused, m.last_status::text AS last_status
FROM projects p
LEFT JOIN monitors m ON m.project_id = p.id AND m.show_on_status_page
WHERE p.is_public AND ($1::uuid[] IS NULL OR p.id = ANY($1::uuid[]))
ORDER BY p.id, m.created_at`;

const STATUS_DAYS = `
SELECT source.monitor_id, source.day::text AS day, source.checks, source.failures
FROM check_rollups_daily source
${PUBLIC_MONITORS}
WHERE source.day >= (now() AT TIME ZONE 'UTC')::date - $2::int`;

const STATUS_INCIDENTS = `
SELECT m.project_id, m.name AS monitor_name, source.started_at, source.resolved_at, source.note
FROM incidents source
${PUBLIC_MONITORS}
WHERE source.resolved_at IS NULL
   OR source.started_at >= now() - make_interval(days => $2::int)
ORDER BY source.started_at DESC`;

const PROJECTS_FOR_MONITORS = `
SELECT DISTINCT project_id FROM monitors WHERE id = ANY($1::uuid[])`;

// Finds complete hours whose raw count differs from their rollup (new, or late results arrived
// after a failed flush) and rebuilds just those, so a repeat run changes nothing.
const ROLL_UP_HOURS = `
WITH counts AS (
  SELECT monitor_id, date_trunc('hour', checked_at, 'UTC') AS hour, count(*)::int AS checks
  FROM check_results
  WHERE checked_at < date_trunc('hour', now(), 'UTC')
  GROUP BY 1, 2
),
stale AS (
  SELECT c.monitor_id, c.hour
  FROM counts c
  LEFT JOIN check_rollups_hourly h ON h.monitor_id = c.monitor_id AND h.hour = c.hour
  WHERE h.checks IS DISTINCT FROM c.checks
),
upserted AS (
  INSERT INTO check_rollups_hourly
    (monitor_id, hour, checks, failures, latency_avg_ms, latency_p95_ms, latency_max_ms)
  SELECT s.monitor_id, s.hour, count(*)::int, (count(*) FILTER (WHERE NOT r.ok))::int,
         round(avg(r.latency_ms) FILTER (WHERE r.ok))::int,
         round(percentile_cont(0.95) WITHIN GROUP (ORDER BY r.latency_ms) FILTER (WHERE r.ok))::int,
         max(r.latency_ms) FILTER (WHERE r.ok)
  FROM stale s
  JOIN check_results r
    ON r.monitor_id = s.monitor_id
   AND r.checked_at >= s.hour AND r.checked_at < s.hour + interval '1 hour'
  GROUP BY s.monitor_id, s.hour
  ON CONFLICT (monitor_id, hour) DO UPDATE
  SET checks = excluded.checks, failures = excluded.failures,
      latency_avg_ms = excluded.latency_avg_ms, latency_p95_ms = excluded.latency_p95_ms,
      latency_max_ms = excluded.latency_max_ms
  RETURNING hour
)
SELECT count(*)::int AS hours, min(hour) AS oldest FROM upserted`;

// Average latency is weighted by successful checks. The daily p95 is the worst hourly p95: an
// upper bound, since raw checks aren't kept long enough to compute a true one (ADR-0002).
const ROLL_UP_DAYS = `
INSERT INTO check_rollups_daily (monitor_id, day, checks, failures, latency_avg_ms, latency_p95_ms)
SELECT monitor_id, (hour AT TIME ZONE 'UTC')::date, sum(checks)::int, sum(failures)::int,
       round(sum(latency_avg_ms * (checks - failures))::numeric
             / nullif(sum(checks - failures) FILTER (WHERE latency_avg_ms IS NOT NULL), 0))::int,
       max(latency_p95_ms)
FROM check_rollups_hourly
WHERE hour >= $1::timestamptz
GROUP BY 1, 2
ON CONFLICT (monitor_id, day) DO UPDATE
SET checks = excluded.checks, failures = excluded.failures,
    latency_avg_ms = excluded.latency_avg_ms, latency_p95_ms = excluded.latency_p95_ms`;

// Raw checks go a whole hour at a time, and only if that hour has a rollup, so a rollup is never
// rebuilt from part of an hour. At most 24 hours per run keeps catching up after an outage cheap.
const DELETE_RAW = `
WITH cutoff AS (
  SELECT least(
    date_trunc('hour', now() - make_interval(days => $1::int), 'UTC'),
    date_trunc('hour', (SELECT min(checked_at) FROM check_results), 'UTC') + interval '24 hours'
  ) AS before
),
deleted AS (
  DELETE FROM check_results r
  USING cutoff
  WHERE r.checked_at < cutoff.before
    AND EXISTS (
      SELECT 1 FROM check_rollups_hourly h
      WHERE h.monitor_id = r.monitor_id AND h.hour = date_trunc('hour', r.checked_at, 'UTC')
    )
  RETURNING 1
)
SELECT count(*)::int AS n FROM deleted`;

const DELETE_HOURLY = `
WITH deleted AS (
  DELETE FROM check_rollups_hourly
  WHERE hour < now() - make_interval(days => $1::int)
  RETURNING 1
)
SELECT count(*)::int AS n FROM deleted`;

const DELETE_DAILY = `
WITH deleted AS (
  DELETE FROM check_rollups_daily
  WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::int
  RETURNING 1
)
SELECT count(*)::int AS n FROM deleted`;

// Open incidents stay however old they are. Alert deliveries go with their incident.
const DELETE_INCIDENTS = `
WITH deleted AS (
  DELETE FROM incidents
  WHERE resolved_at < now() - make_interval(days => $1::int)
  RETURNING 1
)
SELECT count(*)::int AS n FROM deleted`;

function iso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : undefined;
}

function toJobs(rows: Record<string, unknown>[], event: IncidentEvent): AlertJob[] {
  return rows.map((r) => ({
    deliveryId: String(r.delivery_id),
    incidentId: String(r.incident_id),
    channelId: String(r.channel_id),
    channelType: r.channel_type === "telegram" ? "telegram" : "discord",
    secretEnc: String(r.secret_enc),
    message: {
      event: event.type,
      projectName: String(r.project_name),
      monitorName: String(r.monitor_name),
      monitorUrl: String(r.monitor_url),
      startedAt: iso(r.started_at),
      resolvedAt: iso(r.resolved_at),
      cause: typeof r.cause === "string" ? (r.cause as CheckError) : undefined,
      lastStatusCode: typeof r.last_status_code === "number" ? r.last_status_code : null,
      reason: event.type === "resolved" ? event.reason : undefined,
    },
  }));
}

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
      const rows =
        event.type === "opened"
          ? await query(OPEN_INCIDENT, [
              event.monitorId,
              event.startedAt,
              event.cause,
              event.lastStatusCode,
            ])
          : await query(RESOLVE_INCIDENT, [event.monitorId, event.resolvedAt, event.reason]);
      return toJobs(rows, event);
    },

    async updateDeliveries(rows) {
      if (rows.length === 0) return;
      await query(UPDATE_DELIVERIES, [
        rows.map((r) => r.id),
        rows.map((r) => r.state),
        rows.map((r) => r.attempts),
        rows.map((r) => r.lastError),
        rows.map((r) => r.sentAt),
        rows.map((r) => r.nextAttemptAt),
      ]);
    },

    async disableChannels(rows) {
      if (rows.length === 0) return;
      await query(DISABLE_CHANNELS, [rows.map((r) => r.channelId), rows.map((r) => r.reason)]);
    },

    async loadStatusData(projectIds) {
      const [monitors, days, incidents] = await Promise.all([
        query(STATUS_MONITORS, [projectIds]),
        query(STATUS_DAYS, [projectIds, STATUS_PAGE_DAYS]),
        query(STATUS_INCIDENTS, [projectIds, STATUS_PAGE_INCIDENT_DAYS]),
      ]);
      return {
        monitors: monitors.map((r) => ({
          projectId: String(r.project_id),
          projectName: String(r.project_name),
          slug: String(r.slug),
          note: typeof r.status_note === "string" ? r.status_note : null,
          monitorId: typeof r.monitor_id === "string" ? r.monitor_id : null,
          monitorName: typeof r.monitor_name === "string" ? r.monitor_name : null,
          shard: r.shard === null ? null : Number(r.shard),
          isPaused: Boolean(r.is_paused),
          lastStatus: typeof r.last_status === "string" ? r.last_status : null,
        })),
        days: days.map((r) => ({
          monitorId: String(r.monitor_id),
          day: String(r.day),
          checks: Number(r.checks),
          failures: Number(r.failures),
        })),
        incidents: incidents.map((r) => ({
          projectId: String(r.project_id),
          monitorName: String(r.monitor_name),
          startedAt: iso(r.started_at) ?? "",
          resolvedAt: iso(r.resolved_at) ?? null,
          note: typeof r.note === "string" ? r.note : null,
        })),
      };
    },

    async rollUpHours() {
      const [row] = await query(ROLL_UP_HOURS, []);
      return { hours: Number(row?.hours ?? 0), oldest: iso(row?.oldest) ?? null };
    },

    async rollUpDays(fromIso) {
      await query(ROLL_UP_DAYS, [fromIso]);
    },

    async applyRetention() {
      const count = async (sql: string, days: number) =>
        Number((await query(sql, [days]))[0]?.n ?? 0);
      return {
        raw: await count(DELETE_RAW, RETENTION_DAYS.raw),
        hourly: await count(DELETE_HOURLY, RETENTION_DAYS.hourly),
        daily: await count(DELETE_DAILY, RETENTION_DAYS.daily),
        incidents: await count(DELETE_INCIDENTS, RETENTION_DAYS.incidents),
      };
    },

    async projectIdsForMonitors(monitorIds) {
      const rows = await query(PROJECTS_FOR_MONITORS, [monitorIds]);
      return rows.map((r) => String(r.project_id));
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
