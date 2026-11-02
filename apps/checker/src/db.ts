import type { AlertMessage, CheckError, CheckerMonitor } from "@pulse/shared";
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
