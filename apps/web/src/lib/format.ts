export type MonitorStatus = "pending" | "up" | "failing" | "down" | "recovering" | "paused";

export const STATUS_LABEL: Record<MonitorStatus, string> = {
  pending: "Pending",
  up: "Up",
  failing: "Failing",
  down: "Down",
  recovering: "Recovering",
  paused: "Paused",
};

/** "just now", "4 min ago", "3 h ago", or a date for anything older than a day. */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatMs(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "–" : `${ms} ms`;
}
