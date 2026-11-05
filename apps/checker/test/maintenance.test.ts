import { describe, expect, it, vi } from "vitest";
import type { CheckerDb } from "../src/db.js";
import { rollupWindowStart, runHourly } from "../src/maintenance.js";
import { SnapshotStore } from "../src/status.js";
import { fakeDb, memorySql } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 5, 13, 0, 0);

describe("rollupWindowStart", () => {
  it("normally starts at yesterday", () => {
    expect(rollupWindowStart(null, NOW)).toBe("2026-11-04T00:00:00.000Z");
    expect(rollupWindowStart("2026-11-05T12:00:00.000Z", NOW)).toBe("2026-11-04T00:00:00.000Z");
  });

  it("goes further back when late results changed an older hour", () => {
    expect(rollupWindowStart("2026-11-01T07:00:00.000Z", NOW)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("never goes back past 29 days, where hourly data is incomplete", () => {
    expect(rollupWindowStart("2026-09-01T07:00:00.000Z", NOW)).toBe("2026-10-07T00:00:00.000Z");
  });
});

describe("runHourly", () => {
  async function open(overrides: Partial<CheckerDb> = {}) {
    const db = { ...(await fakeDb().open()), ...overrides };
    return db;
  }

  it("rolls up, deletes old data, then rebuilds the status pages, in that order", async () => {
    const order: string[] = [];
    const db = await open({
      rollUpHours: () => {
        order.push("hours");
        return Promise.resolve({ hours: 3, oldest: "2026-11-05T10:00:00.000Z" });
      },
      rollUpDays: (from) => {
        order.push(`days from ${from}`);
        return Promise.resolve();
      },
      applyRetention: () => {
        order.push("retention");
        return Promise.resolve({ raw: 5, hourly: 0, daily: 0, incidents: 0 });
      },
      loadStatusData: () => {
        order.push("snapshots");
        return Promise.resolve({ monitors: [], days: [], incidents: [] });
      },
    });
    const summary = await runHourly(db, new SnapshotStore(memorySql()), NOW, vi.fn());
    expect(order).toEqual([
      "hours",
      "days from 2026-11-04T00:00:00.000Z",
      "retention",
      "snapshots",
    ]);
    expect(summary).toEqual({
      hoursRolledUp: 3,
      deleted: { raw: 5, hourly: 0, daily: 0, incidents: 0 },
    });
  });

  it("deletes nothing if rollups fail, but still rebuilds the status pages", async () => {
    const applyRetention = vi.fn(() =>
      Promise.resolve({ raw: 0, hourly: 0, daily: 0, incidents: 0 }),
    );
    const loadStatusData = vi.fn(() => Promise.resolve({ monitors: [], days: [], incidents: [] }));
    const log = vi.fn();
    const db = await open({
      rollUpHours: () => Promise.reject(new Error("rollup broke")),
      applyRetention,
      loadStatusData,
    });
    const summary = await runHourly(db, new SnapshotStore(memorySql()), NOW, log);
    expect(applyRetention).not.toHaveBeenCalled();
    expect(loadStatusData).toHaveBeenCalled();
    expect(summary.deleted).toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "rollups failed; nothing deleted this hour" }),
    );
  });

  it("keeps the old snapshots if Postgres can't be read at all", async () => {
    const store = new SnapshotStore(memorySql());
    const replaceAll = vi.spyOn(store, "replaceAll");
    const db = await open({ loadStatusData: () => Promise.reject(new Error("database down")) });
    await expect(runHourly(db, store, NOW, vi.fn())).rejects.toThrow("database down");
    expect(replaceAll).not.toHaveBeenCalled();
  });
});
