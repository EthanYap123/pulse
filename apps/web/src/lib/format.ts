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

/** "45 s", "12 min", "3 h 5 min", "2 d 4 h". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export const CAUSE_LABEL: Record<string, string> = {
  status: "Unexpected status code",
  timeout: "Timed out",
  dns: "DNS lookup failed",
  tls: "TLS/certificate error",
  connection: "Couldn’t connect",
};
