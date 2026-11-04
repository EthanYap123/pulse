import type { LiveStatus } from "./checker-protocol.js";

/** Days of history on a status page, and how far back its incident list goes. */
export const STATUS_PAGE_DAYS = 90;
export const STATUS_PAGE_INCIDENT_DAYS = 14;

export type PublicStatus = LiveStatus["status"];
export type OverallStatus = "operational" | "degraded" | "outage" | "unknown";

export type UptimeDay = { day: string; uptimePct: number | null };

/** The JSON a status page renders (GET /public/v1/status/:slug, docs/API.md). */
export type StatusPage = {
  project: { name: string; slug: string; note: string | null };
  overall: OverallStatus;
  generatedAt: string;
  snapshotAt: string | null;
  monitors: {
    id: string;
    name: string;
    status: PublicStatus;
    uptime90dPct: number | null;
    days: UptimeDay[];
  }[];
  incidents: {
    monitorName: string;
    startedAt: string;
    resolvedAt: string | null;
    durationSec: number | null;
    note: string | null;
  }[];
};

/** Down beats degraded beats up. With nothing checked yet there is nothing to claim. */
export function overallStatus(statuses: PublicStatus[]): OverallStatus {
  if (statuses.includes("down")) return "outage";
  if (statuses.includes("failing") || statuses.includes("recovering")) return "degraded";
  if (statuses.length === 0 || statuses.every((s) => s === "pending")) return "unknown";
  return "operational";
}

export type UptimeTier = "none" | "perfect" | "good" | "degraded" | "poor";

/** The bands used for a day's bar on a status page (US-14). */
export function uptimeTier(uptimePct: number | null): UptimeTier {
  if (uptimePct === null) return "none";
  if (uptimePct >= 100) return "perfect";
  if (uptimePct >= 99) return "good";
  if (uptimePct >= 95) return "degraded";
  return "poor";
}

/** Percent to 2 decimals. Never rounds up to 100 while there were failures. */
export function uptimePct(checks: number, failures: number): number | null {
  if (checks === 0) return null;
  const pct = Math.floor(((checks - failures) / checks) * 10_000) / 100;
  return pct;
}
