import type { MonitorStatus } from "./format";

/** Response shapes from docs/API.md. */

export type User = { id: string; email: string; createdAt: string };

export type Me = User & {
  usage: { projects: number; monitors: number };
  limits: { projects: number; monitors: number };
};

export type Project = {
  id: string;
  name: string;
  slug: string;
  isPublic: boolean;
  statusNote: string | null;
  monitorCount: number;
  createdAt: string;
};

export type Monitor = {
  id: string;
  projectId: string;
  name: string;
  url: string;
  method: "GET" | "HEAD";
  expectedStatus: { min: number; max: number };
  timeoutMs: number;
  failureThreshold: number;
  headerNames: string[];
  showOnStatusPage: boolean;
  isPaused: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  statusSource: "live" | "last_flush";
  openIncidentId: string | null;
};

export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSec: number | null;
  cause: "status" | "timeout" | "dns" | "tls" | "connection";
  lastStatusCode: number | null;
  resolveReason: "recovered" | "paused" | "deleted" | null;
  note: string | null;
};

export type HistoryRange = "24h" | "7d" | "30d";

export type HistoryPoint = {
  t: string;
  ok: boolean;
  latencyMs: number | null;
  avgMs?: number | null;
  p95Ms?: number | null;
  checks?: number;
  failures?: number;
};

export type History = { range: HistoryRange; points: HistoryPoint[]; uptimePct: number | null };

export type Channel = {
  id: string;
  projectId: string;
  type: "discord" | "telegram";
  name: string;
  cooldownMinutes: number;
  state: "pending_link" | "active" | "disabled";
  disabledReason: string | null;
  target: string | null;
  createdAt: string;
};
