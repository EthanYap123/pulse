import type { OverallStatus, UptimeDay } from "@pulse/shared";

export const OVERALL: Record<OverallStatus, { symbol: string; text: string }> = {
  operational: { symbol: "●", text: "All systems operational" },
  degraded: { symbol: "▲", text: "Some systems are having problems" },
  outage: { symbol: "✕", text: "Outage in progress" },
  unknown: { symbol: "○", text: "Waiting for the first checks" },
};

const DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Status pages use UTC throughout, so the bars and times agree for every visitor. */
export function dayLabel(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

export function timeLabel(iso: string): string {
  return `${TIME.format(new Date(iso))} UTC`;
}

/** A sentence for one day's bar. */
export function dayReadout({ day, uptimePct }: UptimeDay): string {
  return uptimePct === null
    ? `${dayLabel(day)}: no data`
    : `${dayLabel(day)}: ${uptimePct}% uptime`;
}

/** The whole 90 days in words, so the history doesn't depend on seeing the colours. */
export function daysSummary(days: UptimeDay[]): string {
  const bad = days.filter((d) => d.uptimePct !== null && d.uptimePct < 100);
  if (days.every((d) => d.uptimePct === null)) return "No checks recorded yet.";
  if (bad.length === 0) return "No downtime recorded in the last 90 days.";
  const worst = bad.reduce((a, b) => ((b.uptimePct ?? 100) < (a.uptimePct ?? 100) ? b : a));
  const count = bad.length === 1 ? "1 day" : `${bad.length} days`;
  return `Downtime on ${count}. Lowest: ${dayReadout(worst)}.`;
}
