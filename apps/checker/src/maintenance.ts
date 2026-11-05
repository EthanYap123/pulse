import type { CheckerDb } from "./db.js";
import { buildSnapshots, type SnapshotStore } from "./status.js";

export type HourlySummary = {
  hoursRolledUp: number;
  deleted: { raw: number; hourly: number; daily: number; incidents: number } | null;
};

/**
 * The hourly job (ADR-0002), run after the shards have flushed. Every step can repeat safely,
 * so a missed or doubled hour changes nothing. Old data is only deleted after rollups succeed,
 * and the status pages are rebuilt either way.
 */
export async function runHourly(
  db: CheckerDb,
  store: SnapshotStore,
  now: number,
  log: (entry: Record<string, unknown>) => void,
): Promise<HourlySummary> {
  const summary: HourlySummary = { hoursRolledUp: 0, deleted: null };
  try {
    const { hours, oldest } = await db.rollUpHours();
    summary.hoursRolledUp = hours;
    await db.rollUpDays(rollupWindowStart(oldest, now));
    summary.deleted = await db.applyRetention();
  } catch (error) {
    log({ msg: "rollups failed; nothing deleted this hour", error: String(error) });
  }
  store.replaceAll(buildSnapshots(await db.loadStatusData(null), now));
  log({ msg: "hourly maintenance", ...summary });
  return summary;
}

const DAY_MS = 86_400_000;

/**
 * Where to recompute daily rollups from: yesterday, or further back if late results changed an
 * older hour. Never past 29 days, because hourly rollups older than 30 days are deleted and
 * recomputing from a partial day would overwrite a correct daily figure with a wrong one.
 */
export function rollupWindowStart(oldestChangedHour: string | null, now: number): string {
  const startOfDay = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;
  const yesterday = startOfDay(now) - DAY_MS;
  const floor = startOfDay(now) - 29 * DAY_MS;
  const oldest = oldestChangedHour ? startOfDay(Date.parse(oldestChangedHour)) : yesterday;
  return new Date(Math.max(Math.min(oldest, yesterday), floor)).toISOString();
}
