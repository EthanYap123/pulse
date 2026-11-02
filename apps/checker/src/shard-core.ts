import {
  INITIAL_STATE,
  LIMITS,
  nextState,
  type CheckerMonitor,
  type LiveStatus,
  type MonitorState,
} from "@pulse/shared";
import type { Decrypt } from "./crypto.js";
import type { CheckerDb, IncidentEvent } from "./db.js";
import { runChecks, type CheckDeps, type CheckJob, type CheckResult } from "./run-checks.js";

/** The subset of the Durable Object SQLite API the shard needs, so tests can use node:sqlite. */
export interface Sql {
  all<T>(query: string, ...params: (string | number | null)[]): T[];
  run(query: string, ...params: (string | number | null)[]): void;
}

export type ShardDeps = CheckDeps & {
  shard: number;
  openDb: () => Promise<CheckerDb>;
  decrypt: Decrypt | null;
  log: (entry: Record<string, unknown>) => void;
};

type StoredState = MonitorState & {
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
};

/** A tick that started this long ago and never finished is treated as dead. */
const STALE_TICK_MS = 4 * 60 * 1000;

/** Workers Free: outbound requests per invocation (measured, spikes/do-subrequests). */
const SUBREQUESTS_PER_INVOCATION = 50;
/** Queries the hourly flush makes: insert results, update statuses, load config. */
const FLUSH_QUERIES = 3;
/** Incident writes per tick at most; the rest wait for the next tick. */
const MAX_EVENT_WRITES_PER_TICK = 8;

export type TickResult =
  | { kind: "skipped"; reason: "tick_in_progress" }
  | {
      kind: "done";
      checked: number;
      flushed: number | null;
      overCap: number;
      incidentEventsWritten: number;
    };

/**
 * One checker shard (docs/ARCHITECTURE.md §3). Holds its monitors' config and state and
 * buffers results in its own SQLite; Postgres is written once an hour by `flush`.
 */
export class ShardCore {
  constructor(
    private readonly sql: Sql,
    private readonly deps: ShardDeps,
  ) {
    sql.run(`CREATE TABLE IF NOT EXISTS monitors (id TEXT PRIMARY KEY, config TEXT NOT NULL)`);
    sql.run(`CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    // One row per tick (a JSON array), not per check: keeps SQLite row writes low.
    sql.run(`CREATE TABLE IF NOT EXISTS buffer (tick_at TEXT PRIMARY KEY, results TEXT NOT NULL)`);
    sql.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    // Incident opens/resolves waiting to be written to Postgres, in the order they happened.
    sql.run(
      `CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id TEXT NOT NULL, data TEXT NOT NULL)`,
    );
  }

  // Config ---------------------------------------------------------------------

  upsert(monitor: CheckerMonitor): void {
    const previous = this.config(monitor.id);
    if (monitor.isPaused && previous && !previous.isPaused) this.onPaused(monitor.id);
    this.sql.run(
      `INSERT INTO monitors (id, config) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET config = excluded.config`,
      monitor.id,
      JSON.stringify(monitor),
    );
  }

  remove(monitorId: string): void {
    this.sql.run(`DELETE FROM monitors WHERE id = ?`, monitorId);
    this.sql.run(`DELETE FROM state WHERE id = ?`, monitorId);
    // Its incidents are deleted with it in Postgres, so pending writes are moot.
    this.sql.run(`DELETE FROM events WHERE monitor_id = ?`, monitorId);
  }

  /**
   * Pausing ends any open incident (reason "paused") and forgets the monitor's state, so
   * resuming starts fresh at "pending". The API resolves the incident too; both are idempotent.
   */
  private onPaused(monitorId: string): void {
    const state = this.state(monitorId);
    this.sql.run(`DELETE FROM events WHERE monitor_id = ?`, monitorId);
    if (state.status === "down" || state.status === "recovering") {
      this.enqueue({
        type: "resolved",
        monitorId,
        resolvedAt: new Date(this.deps.now()).toISOString(),
        reason: "paused",
      });
    }
    this.sql.run(`DELETE FROM state WHERE id = ?`, monitorId);
  }

  private config(monitorId: string): CheckerMonitor | null {
    const row = this.sql.all<{ config: string }>(
      `SELECT config FROM monitors WHERE id = ?`,
      monitorId,
    )[0];
    return row ? (JSON.parse(row.config) as CheckerMonitor) : null;
  }

  /** Makes this shard's config exactly match `monitors` (Postgres is the source of truth). */
  replaceAll(monitors: CheckerMonitor[]): void {
    const keep = new Set(monitors.map((m) => m.id));
    for (const { id } of this.sql.all<{ id: string }>(`SELECT id FROM monitors`)) {
      if (!keep.has(id)) this.remove(id);
    }
    for (const monitor of monitors) this.upsert(monitor);
  }

  monitors(): CheckerMonitor[] {
    return this.sql
      .all<{ config: string }>(`SELECT config FROM monitors ORDER BY id`)
      .map((row) => JSON.parse(row.config) as CheckerMonitor);
  }

  // Ticks ----------------------------------------------------------------------

  async tick(scheduledTime: number): Promise<TickResult> {
    const started = this.meta("tick_started_at");
    if (started && this.deps.now() - Number(started) < STALE_TICK_MS) {
      this.deps.log({ msg: "tick skipped: previous tick still running", shard: this.deps.shard });
      return { kind: "skipped", reason: "tick_in_progress" };
    }
    this.setMeta("tick_started_at", String(this.deps.now()));
    try {
      // A new or wiped shard has no config yet: load it once from Postgres.
      if (!this.meta("reconciled_at")) await this.reconcileSafely();

      const active = this.monitors().filter((m) => !m.isPaused);
      const due = active.slice(0, LIMITS.checksPerShardTick);
      const overCap = active.length - due.length;
      if (overCap > 0) {
        this.deps.log({ msg: "shard over its per-tick cap", shard: this.deps.shard, overCap });
      }

      const results = await runChecks(await Promise.all(due.map((m) => this.toJob(m))), this.deps);
      for (const [i, result] of results.entries()) this.record(due[i]!, result);
      if (results.length > 0) {
        this.sql.run(
          `INSERT OR REPLACE INTO buffer (tick_at, results) VALUES (?, ?)`,
          new Date(scheduledTime).toISOString(),
          JSON.stringify(results),
        );
      }

      // Incidents go to Postgres now; check results wait for the hourly flush. Each write is
      // a subrequest, so only what's left of this invocation's 50 is used.
      const isFlushTick = new Date(scheduledTime).getUTCMinutes() === 0;
      const spare =
        SUBREQUESTS_PER_INVOCATION - results.length - (isFlushTick ? FLUSH_QUERIES : 0) - 1;
      const incidentEventsWritten = await this.writeEvents(
        Math.min(MAX_EVENT_WRITES_PER_TICK, spare),
      );

      const flushed = isFlushTick ? (await this.flush()).flushed : null;
      return { kind: "done", checked: results.length, flushed, overCap, incidentEventsWritten };
    } finally {
      this.sql.run(`DELETE FROM meta WHERE key = 'tick_started_at'`);
    }
  }

  private async toJob(monitor: CheckerMonitor): Promise<CheckJob> {
    const headers: Record<string, string> = {};
    for (const [name, encrypted] of Object.entries(monitor.encryptedHeaders)) {
      if (!this.deps.decrypt) {
        this.deps.log({ msg: "no ENCRYPTION_KEY: header skipped", monitorId: monitor.id, name });
        continue;
      }
      try {
        headers[name] = await this.deps.decrypt(encrypted);
      } catch {
        this.deps.log({ msg: "header could not be decrypted", monitorId: monitor.id, name });
      }
    }
    return {
      monitorId: monitor.id,
      url: monitor.url,
      method: monitor.method,
      timeoutMs: monitor.timeoutMs,
      headers,
      expectedStatus: monitor.expectedStatus,
    };
  }

  private record(monitor: CheckerMonitor, result: CheckResult): void {
    const previous = this.state(monitor.id);
    const step = nextState(previous, result, monitor.failureThreshold, result.checkedAt);
    const stored: StoredState = {
      ...step.state,
      lastCheckedAt: result.checkedAt,
      lastLatencyMs: result.latencyMs,
    };
    this.sql.run(
      `INSERT INTO state (id, data) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      monitor.id,
      JSON.stringify(stored),
    );
    if (step.event?.type === "incident_opened") {
      this.enqueue({
        type: "opened",
        monitorId: monitor.id,
        startedAt: step.event.startedAt,
        cause: result.error ?? "status",
        lastStatusCode: result.statusCode,
      });
    } else if (step.event?.type === "incident_resolved") {
      this.enqueue({
        type: "resolved",
        monitorId: monitor.id,
        resolvedAt: step.event.resolvedAt,
        reason: "recovered",
      });
    }
  }

  private enqueue(event: IncidentEvent): void {
    this.sql.run(
      `INSERT INTO events (monitor_id, data) VALUES (?, ?)`,
      event.monitorId,
      JSON.stringify(event),
    );
    this.deps.log({ msg: `incident ${event.type}`, ...event });
  }

  /**
   * Writes up to `limit` pending incident events to Postgres, oldest first. Stops at the
   * first failure so events for a monitor are never applied out of order; the rest are
   * retried on the next tick.
   */
  async writeEvents(limit: number): Promise<number> {
    if (limit <= 0) return 0;
    const pending = this.sql.all<{ seq: number; data: string }>(
      `SELECT seq, data FROM events ORDER BY seq LIMIT ?`,
      limit,
    );
    if (pending.length === 0) return 0;
    let written = 0;
    try {
      const db = await this.deps.openDb();
      try {
        for (const row of pending) {
          await db.writeIncidentEvent(JSON.parse(row.data) as IncidentEvent);
          this.sql.run(`DELETE FROM events WHERE seq = ?`, row.seq);
          written++;
        }
      } finally {
        await db.close();
      }
    } catch (error) {
      this.deps.log({ msg: "incident write failed", shard: this.deps.shard, error: String(error) });
    }
    return written;
  }

  pendingEvents(): IncidentEvent[] {
    return this.sql
      .all<{ data: string }>(`SELECT data FROM events ORDER BY seq`)
      .map((row) => JSON.parse(row.data) as IncidentEvent);
  }

  private state(monitorId: string): StoredState {
    const row = this.sql.all<{ data: string }>(`SELECT data FROM state WHERE id = ?`, monitorId)[0];
    return row
      ? (JSON.parse(row.data) as StoredState)
      : { ...INITIAL_STATE, lastCheckedAt: null, lastLatencyMs: null };
  }

  // Flush ------------------------------------------------------------------------

  /** Writes buffered results and latest statuses to Postgres, then reconciles config. */
  async flush(): Promise<{ flushed: number }> {
    const ticks = this.sql.all<{ tick_at: string; results: string }>(
      `SELECT tick_at, results FROM buffer ORDER BY tick_at`,
    );
    const rows = ticks.flatMap((t) => JSON.parse(t.results) as CheckResult[]);
    const db = await this.deps.openDb();
    try {
      await db.insertResults(rows);
      await db.updateStatuses(
        this.monitors().flatMap((m) => {
          const s = this.state(m.id);
          return s.lastCheckedAt && !m.isPaused
            ? [{ monitorId: m.id, status: s.status, checkedAt: s.lastCheckedAt }]
            : [];
        }),
      );
      // Only after Postgres has the rows; a failed flush keeps them for the next try.
      for (const t of ticks) this.sql.run(`DELETE FROM buffer WHERE tick_at = ?`, t.tick_at);
      await this.reconcile(db);
    } finally {
      await db.close();
    }
    this.deps.log({ msg: "flushed", shard: this.deps.shard, rows: rows.length });
    return { flushed: rows.length };
  }

  private async reconcile(db: CheckerDb): Promise<void> {
    this.replaceAll(await db.loadShardMonitors(this.deps.shard));
    this.setMeta("reconciled_at", new Date(this.deps.now()).toISOString());
  }

  private async reconcileSafely(): Promise<void> {
    try {
      const db = await this.deps.openDb();
      try {
        await this.reconcile(db);
      } finally {
        await db.close();
      }
    } catch (error) {
      this.deps.log({ msg: "reconcile failed", shard: this.deps.shard, error: String(error) });
    }
  }

  // Reads --------------------------------------------------------------------------

  live(monitorIds: string[]): LiveStatus[] {
    const configs = new Map(this.monitors().map((m) => [m.id, m]));
    return monitorIds.flatMap((id) => {
      const config = configs.get(id);
      if (!config) return [];
      const s = this.state(id);
      return [
        {
          monitorId: id,
          status: config.isPaused ? "paused" : s.status,
          lastCheckedAt: s.lastCheckedAt,
          lastLatencyMs: s.lastLatencyMs,
        },
      ];
    });
  }

  pendingResults(): number {
    return this.sql
      .all<{ results: string }>(`SELECT results FROM buffer`)
      .reduce((n, t) => n + (JSON.parse(t.results) as unknown[]).length, 0);
  }

  private meta(key: string): string | null {
    return (
      this.sql.all<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, key)[0]?.value ?? null
    );
  }

  private setMeta(key: string, value: string): void {
    this.sql.run(
      `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }
}
