import {
  STATUS_PAGE_DAYS,
  overallStatus,
  uptimePct,
  type LiveStatus,
  type PublicStatus,
  type StatusPage,
  type UptimeDay,
} from "@pulse/shared";
import type { Sql } from "./shard-core.js";

/** The rows CheckerDb.loadStatusData returns. */
export type StatusData = {
  monitors: {
    projectId: string;
    projectName: string;
    slug: string;
    note: string | null;
    /** Null for a public project with no monitors on its page (LEFT JOIN). */
    monitorId: string | null;
    monitorName: string | null;
    shard: number | null;
    isPaused: boolean;
    lastStatus: string | null;
  }[];
  days: { monitorId: string; day: string; checks: number; failures: number }[];
  incidents: {
    projectId: string;
    monitorName: string;
    startedAt: string;
    resolvedAt: string | null;
    note: string | null;
  }[];
};

/** Everything a status page needs that only changes hourly. Live state is merged on read. */
export type StatusSnapshot = Omit<
  StatusPage,
  "overall" | "generatedAt" | "snapshotAt" | "monitors"
> & {
  projectId: string;
  builtAt: string;
  monitors: (StatusPage["monitors"][number] & { shard: number; isPaused: boolean })[];
};

/** The last `STATUS_PAGE_DAYS` UTC days, oldest first, ending today. */
function dayKeys(now: number): string[] {
  const today = Math.floor(now / 86_400_000);
  return Array.from({ length: STATUS_PAGE_DAYS }, (_, i) =>
    new Date((today - STATUS_PAGE_DAYS + 1 + i) * 86_400_000).toISOString().slice(0, 10),
  );
}

function durationSec(startedAt: string, resolvedAt: string | null): number | null {
  if (!resolvedAt) return null;
  return Math.round((Date.parse(resolvedAt) - Date.parse(startedAt)) / 1000);
}

export function buildSnapshots(data: StatusData, now: number): StatusSnapshot[] {
  const keys = dayKeys(now);
  const byMonitor = new Map<string, Map<string, { checks: number; failures: number }>>();
  for (const d of data.days) {
    const days =
      byMonitor.get(d.monitorId) ?? new Map<string, { checks: number; failures: number }>();
    days.set(d.day, { checks: d.checks, failures: d.failures });
    byMonitor.set(d.monitorId, days);
  }

  const snapshots = new Map<string, StatusSnapshot>();
  for (const row of data.monitors) {
    const snapshot: StatusSnapshot = snapshots.get(row.projectId) ?? {
      projectId: row.projectId,
      builtAt: new Date(now).toISOString(),
      project: { name: row.projectName, slug: row.slug, note: row.note },
      monitors: [],
      incidents: [],
    };
    snapshots.set(row.projectId, snapshot);
    if (!row.monitorId) continue;

    const recorded = byMonitor.get(row.monitorId);
    let checks = 0;
    let failures = 0;
    const days: UptimeDay[] = keys.map((day) => {
      const d = recorded?.get(day);
      checks += d?.checks ?? 0;
      failures += d?.failures ?? 0;
      return { day, uptimePct: d ? uptimePct(d.checks, d.failures) : null };
    });
    snapshot.monitors.push({
      id: row.monitorId,
      name: row.monitorName ?? "",
      status: row.isPaused ? "paused" : ((row.lastStatus ?? "pending") as PublicStatus),
      uptime90dPct: uptimePct(checks, failures),
      days,
      shard: row.shard ?? 0,
      isPaused: row.isPaused,
    });
  }
  for (const i of data.incidents) {
    snapshots.get(i.projectId)?.incidents.push({
      monitorName: i.monitorName,
      startedAt: i.startedAt,
      resolvedAt: i.resolvedAt,
      durationSec: durationSec(i.startedAt, i.resolvedAt),
      note: i.note,
    });
  }
  return [...snapshots.values()];
}

/**
 * The page a visitor sees: the snapshot with each monitor's live state on top. A monitor
 * the shards can't answer for keeps the status from the snapshot.
 */
export function toStatusPage(
  snapshot: StatusSnapshot,
  live: Map<string, LiveStatus>,
  now: number,
): StatusPage {
  const monitors = snapshot.monitors.map(({ shard: _shard, isPaused: _isPaused, ...m }) => ({
    ...m,
    status: live.get(m.id)?.status ?? m.status,
  }));
  return {
    project: snapshot.project,
    overall: overallStatus(monitors.map((m) => m.status)),
    generatedAt: new Date(now).toISOString(),
    snapshotAt: snapshot.builtAt,
    monitors,
    incidents: snapshot.incidents,
  };
}

/** Stores one snapshot per public project in the Snapshots Durable Object's SQLite. */
export class SnapshotStore {
  constructor(private readonly sql: Sql) {
    sql.run(
      `CREATE TABLE IF NOT EXISTS snapshots (project_id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, data TEXT NOT NULL)`,
    );
  }

  get(slug: string): StatusSnapshot | null {
    const row = this.sql.all<{ data: string }>(
      `SELECT data FROM snapshots WHERE slug = ?`,
      slug,
    )[0];
    return row ? (JSON.parse(row.data) as StatusSnapshot) : null;
  }

  /** Replaces every snapshot: projects that are gone or now private disappear. */
  replaceAll(snapshots: StatusSnapshot[]): void {
    this.sql.run(`DELETE FROM snapshots`);
    for (const s of snapshots) this.put(s);
  }

  /** Refreshes some projects. One that came back with no snapshot was deleted or made private. */
  replaceProjects(projectIds: string[], snapshots: StatusSnapshot[]): void {
    for (const id of projectIds) this.sql.run(`DELETE FROM snapshots WHERE project_id = ?`, id);
    for (const s of snapshots) this.put(s);
  }

  private put(s: StatusSnapshot): void {
    this.sql.run(
      `INSERT OR REPLACE INTO snapshots (project_id, slug, data) VALUES (?, ?, ?)`,
      s.projectId,
      s.project.slug,
      JSON.stringify(s),
    );
  }
}
