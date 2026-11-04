import type { LiveStatus } from "@pulse/shared";
import { describe, expect, it } from "vitest";
import {
  SnapshotStore,
  buildSnapshots,
  toStatusPage,
  type StatusData,
  type StatusSnapshot,
} from "../src/status.js";
import { idFor, memorySql } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const PROJECT = idFor(100);
const M1 = idFor(1);
const M2 = idFor(2);

function row(overrides: Partial<StatusData["monitors"][number]> = {}) {
  return {
    projectId: PROJECT,
    projectName: "Site",
    slug: "site",
    note: null,
    monitorId: M1,
    monitorName: "API",
    shard: 2,
    isPaused: false,
    lastStatus: "up",
    ...overrides,
  };
}

function data(overrides: Partial<StatusData> = {}): StatusData {
  return { monitors: [row()], days: [], incidents: [], ...overrides };
}

function live(monitorId: string, status: LiveStatus["status"]): Map<string, LiveStatus> {
  return new Map([[monitorId, { monitorId, status, lastCheckedAt: null, lastLatencyMs: 10 }]]);
}

describe("buildSnapshots", () => {
  it("makes 90 days ending today, oldest first, with null for days without checks", () => {
    const [snapshot] = buildSnapshots(data(), NOW);
    const days = snapshot!.monitors[0]!.days;
    expect(days).toHaveLength(90);
    expect(days[0]?.day).toBe("2026-08-07");
    expect(days[89]?.day).toBe("2026-11-04");
    expect(days.every((d) => d.uptimePct === null)).toBe(true);
    expect(snapshot!.monitors[0]!.uptime90dPct).toBeNull();
  });

  it("works out each day's uptime and the 90-day total", () => {
    const [snapshot] = buildSnapshots(
      data({
        days: [
          { monitorId: M1, day: "2026-11-03", checks: 100, failures: 0 },
          { monitorId: M1, day: "2026-11-04", checks: 100, failures: 10 },
        ],
      }),
      NOW,
    );
    const monitor = snapshot!.monitors[0]!;
    expect(monitor.days[88]?.uptimePct).toBe(100);
    expect(monitor.days[89]?.uptimePct).toBe(90);
    expect(monitor.uptime90dPct).toBe(95);
  });

  it("ignores checks older than 90 days", () => {
    const [snapshot] = buildSnapshots(
      data({ days: [{ monitorId: M1, day: "2026-01-01", checks: 10, failures: 10 }] }),
      NOW,
    );
    expect(snapshot!.monitors[0]!.uptime90dPct).toBeNull();
  });

  it("groups monitors and incidents by project, and keeps projects with no monitors", () => {
    const other = idFor(101);
    const snapshots = buildSnapshots(
      data({
        monitors: [
          row(),
          row({ monitorId: M2, monitorName: "Web", shard: 3 }),
          row({ projectId: other, slug: "empty", monitorId: null, monitorName: null, shard: null }),
        ],
        incidents: [
          {
            projectId: PROJECT,
            monitorName: "API",
            startedAt: "2026-11-04T10:00:00.000Z",
            resolvedAt: "2026-11-04T10:15:00.000Z",
            note: "Deploy went wrong",
          },
        ],
      }),
      NOW,
    );
    expect(snapshots.map((s) => [s.project.slug, s.monitors.length])).toEqual([
      ["site", 2],
      ["empty", 0],
    ]);
    expect(snapshots[0]?.incidents).toEqual([
      {
        monitorName: "API",
        startedAt: "2026-11-04T10:00:00.000Z",
        resolvedAt: "2026-11-04T10:15:00.000Z",
        durationSec: 900,
        note: "Deploy went wrong",
      },
    ]);
  });

  it("shows paused monitors as paused and never-checked ones as pending", () => {
    const snapshots = buildSnapshots(
      data({
        monitors: [
          row({ isPaused: true, lastStatus: "down" }),
          row({ monitorId: M2, lastStatus: null }),
        ],
      }),
      NOW,
    );
    expect(snapshots[0]?.monitors.map((m) => m.status)).toEqual(["paused", "pending"]);
  });

  it("doesn't put the monitor's URL anywhere in the snapshot", () => {
    expect(JSON.stringify(buildSnapshots(data(), NOW))).not.toContain("http");
  });
});

describe("toStatusPage", () => {
  const snapshot = buildSnapshots(data(), NOW)[0]!;

  it("puts live status on top of the snapshot and works out the overall status", () => {
    const page = toStatusPage(snapshot, live(M1, "down"), NOW);
    expect(page.monitors[0]?.status).toBe("down");
    expect(page.overall).toBe("outage");
    expect(page.snapshotAt).toBe(snapshot.builtAt);
  });

  it("keeps the snapshot's status when the shard doesn't answer", () => {
    const page = toStatusPage(snapshot, new Map(), NOW);
    expect(page.monitors[0]?.status).toBe("up");
    expect(page.overall).toBe("operational");
  });

  it("doesn't expose which shard a monitor is on", () => {
    expect(JSON.stringify(toStatusPage(snapshot, new Map(), NOW))).not.toContain("shard");
  });
});

describe("SnapshotStore", () => {
  const snap = (projectId: string, slug: string): StatusSnapshot => ({
    projectId,
    builtAt: new Date(NOW).toISOString(),
    project: { name: slug, slug, note: null },
    monitors: [],
    incidents: [],
  });

  it("stores and reads by slug", () => {
    const store = new SnapshotStore(memorySql());
    store.replaceAll([snap(PROJECT, "site")]);
    expect(store.get("site")?.projectId).toBe(PROJECT);
    expect(store.get("other")).toBeNull();
  });

  it("replaceAll drops projects that are gone", () => {
    const store = new SnapshotStore(memorySql());
    store.replaceAll([snap(PROJECT, "site"), snap(idFor(101), "other")]);
    store.replaceAll([snap(PROJECT, "site")]);
    expect(store.get("other")).toBeNull();
  });

  it("a refresh handles a renamed slug and a project that went private", () => {
    const store = new SnapshotStore(memorySql());
    store.replaceAll([snap(PROJECT, "old-name"), snap(idFor(101), "other")]);
    store.replaceProjects([PROJECT], [snap(PROJECT, "new-name")]);
    expect(store.get("old-name")).toBeNull();
    expect(store.get("new-name")?.projectId).toBe(PROJECT);

    store.replaceProjects([PROJECT], []); // came back empty: private or deleted
    expect(store.get("new-name")).toBeNull();
    expect(store.get("other")).not.toBeNull();
  });
});
