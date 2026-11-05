import { DatabaseSync } from "node:sqlite";
import type { CheckerMonitor } from "@pulse/shared";
import type { AlertJob, CheckerDb, DeliveryUpdate, IncidentEvent } from "../src/db.js";
import type { CheckResult } from "../src/run-checks.js";
import type { Sql } from "../src/shard-core.js";

/** The shard's SQL interface backed by node:sqlite, standing in for Durable Object storage. */
export function memorySql(): Sql {
  const db = new DatabaseSync(":memory:");
  return {
    all: <T>(query: string, ...params: (string | number | null)[]) =>
      db.prepare(query).all(...params) as T[],
    run: (query, ...params) => {
      db.prepare(query).run(...params);
    },
  };
}

/** An in-memory CheckerDb that records what the shard writes. */
export function fakeDb(monitors: CheckerMonitor[] = []) {
  const state = {
    monitors,
    results: [] as CheckResult[],
    statuses: [] as { monitorId: string; status: string; checkedAt: string }[],
    opened: 0,
    failNextInsert: false,
    events: [] as IncidentEvent[],
    failEvents: false,
    /** What writeIncidentEvent returns: the alert deliveries Postgres would create. */
    jobsFor: (_event: IncidentEvent): AlertJob[] => [],
    deliveryUpdates: [] as DeliveryUpdate[],
    disabledChannels: [] as { channelId: string; reason: string }[],
  };
  const open = (): Promise<CheckerDb> => {
    state.opened++;
    return Promise.resolve({
      insertResults: (rows) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          return Promise.reject(new Error("database unavailable"));
        }
        state.results.push(...rows);
        return Promise.resolve();
      },
      updateStatuses: (rows) => {
        state.statuses.push(...rows);
        return Promise.resolve();
      },
      loadShardMonitors: () => Promise.resolve(state.monitors),
      writeIncidentEvent: (event) => {
        if (state.failEvents) return Promise.reject(new Error("database unavailable"));
        state.events.push(event);
        return Promise.resolve(state.jobsFor(event));
      },
      updateDeliveries: (rows) => {
        state.deliveryUpdates.push(...rows);
        return Promise.resolve();
      },
      loadStatusData: () => Promise.resolve({ monitors: [], days: [], incidents: [] }),
      projectIdsForMonitors: () => Promise.resolve([]),
      rollUpHours: () => Promise.resolve({ hours: 0, oldest: null }),
      rollUpDays: () => Promise.resolve(),
      applyRetention: () => Promise.resolve({ raw: 0, hourly: 0, daily: 0, incidents: 0 }),
      disableChannels: (rows) => {
        state.disabledChannels.push(...rows);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
    });
  };
  return { state, open };
}

export function monitor(overrides: Partial<CheckerMonitor> = {}): CheckerMonitor {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    shard: 0,
    url: "https://example.com/",
    method: "GET",
    expectedStatus: { min: 200, max: 399 },
    timeoutMs: 1000,
    failureThreshold: 3,
    encryptedHeaders: {},
    isPaused: false,
    ...overrides,
  };
}

export function idFor(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/**
 * "Bearer fixture-token" encrypted by the API's cipher (apps/api/src/crypto.ts) with the
 * test key "11" x 32. Not a secret: it only proves the checker can read what the API writes.
 */
export const FIXTURE_KEY = "11".repeat(32);
export const ENCRYPTED_FIXTURE =
  "v1.IkUA0CNn5h_ukmbN.6H1MJvTVL6QlGgFafROJfw.28C2C7yCWKuiGFSrJiHO6TKTClk"; // gitleaks:allow
