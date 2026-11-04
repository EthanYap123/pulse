"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { RequireAuth } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { LatencyChart } from "@/components/LatencyChart";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError } from "@/lib/api";
import { formatMs, timeAgo } from "@/lib/format";
import type { History, HistoryRange, Monitor } from "@/lib/types";
import { useData } from "@/lib/use-data";

const RANGES: { value: HistoryRange; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function MonitorView({ monitorId }: { monitorId: string }) {
  const { api } = useAuth();
  const [range, setRange] = useState<HistoryRange>("24h");
  const monitor = useData(monitorId, () => api.get<Monitor>(`/monitors/${monitorId}`));
  const history = useData(`${monitorId}:${range}`, () =>
    api.get<History>(`/monitors/${monitorId}/checks?range=${range}`),
  );

  if (monitor.status === "loading") return <p className="muted center">Loading…</p>;
  if (monitor.status === "error") {
    const missing = monitor.error instanceof ApiError && monitor.error.status === 404;
    return (
      <main className="page">
        <h1>{missing ? "Monitor not found" : "Couldn’t load this monitor"}</h1>
        <Link href="/dashboard">Back to projects</Link>
      </main>
    );
  }
  const m = monitor.data;
  const uptime = history.status === "ready" ? history.data.uptimePct : null;

  return (
    <main className="page">
      <p className="small">
        <Link href={`/projects/${m.projectId}`}>← Monitors</Link>
      </p>
      <div className="page-head">
        <h1>{m.name}</h1>
        <StatusBadge status={m.status} />
      </div>

      <dl className="stats">
        <div>
          <dt>URL</dt>
          <dd className="url">
            {m.method} {m.url}
          </dd>
        </div>
        <div>
          <dt>Last check</dt>
          <dd>
            {timeAgo(m.lastCheckedAt)} · {formatMs(m.lastLatencyMs)}
          </dd>
        </div>
        <div>
          <dt>Uptime ({range})</dt>
          <dd>{uptime === null ? "–" : `${uptime}%`}</dd>
        </div>
        <div>
          <dt>Rules</dt>
          <dd>
            Expects {m.expectedStatus.min}–{m.expectedStatus.max}, times out after{" "}
            {m.timeoutMs / 1000} s, down after {m.failureThreshold} failures
          </dd>
        </div>
      </dl>

      <section className="card">
        <div className="chart-head">
          <h2>Response time</h2>
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={range === r.value}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {history.status === "ready" ? (
          <LatencyChart points={history.data.points} range={range} />
        ) : history.status === "error" ? (
          <p className="chart-empty error">Couldn’t load the history.</p>
        ) : (
          <p className="chart-empty muted">Loading…</p>
        )}
      </section>
    </main>
  );
}

export default function MonitorPage() {
  const { monitorId } = useParams<{ monitorId: string }>();
  return (
    <RequireAuth>
      <MonitorView monitorId={monitorId} />
    </RequireAuth>
  );
}
