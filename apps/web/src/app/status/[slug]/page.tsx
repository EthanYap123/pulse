import type { StatusPage } from "@pulse/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/StatusBadge";
import { UptimeBars } from "@/components/UptimeBars";
import { formatDuration } from "@/lib/format";
import { OVERALL, timeLabel } from "@/lib/status";

/** Rendered on demand, then served from the cache for 60 s however many people visit. */
export const revalidate = 60;

/** No pages at build time; returning a list at all is what makes Next cache them on demand. */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

type Params = { params: Promise<{ slug: string }> };

async function loadStatus(slug: string): Promise<StatusPage | "missing" | "unavailable"> {
  const base = process.env.CHECKER_URL ?? "http://localhost:8787";
  try {
    const res = await fetch(`${base}/public/v1/status/${encodeURIComponent(slug)}`, {
      next: { revalidate },
    });
    if (res.status === 404) return "missing";
    return res.ok ? ((await res.json()) as StatusPage) : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const status = await loadStatus((await params).slug);
  return { title: typeof status === "string" ? "Status" : `${status.project.name} status` };
}

export default async function PublicStatusPage({ params }: Params) {
  const status = await loadStatus((await params).slug);
  if (status === "missing") notFound();
  if (status === "unavailable") {
    return (
      <main className="page">
        <h1>Status is unavailable right now</h1>
        <p className="muted">This page couldn’t be loaded. Try again in a minute.</p>
      </main>
    );
  }

  const overall = OVERALL[status.overall];
  return (
    <main className="page">
      <h1>{status.project.name}</h1>
      <div className={`overall overall-${status.overall}`} role="status">
        <span aria-hidden="true">{overall.symbol}</span> {overall.text}
      </div>
      {status.project.note && <p className="card">{status.project.note}</p>}

      {status.monitors.length === 0 ? (
        <p className="card muted">Nothing is being monitored on this page yet.</p>
      ) : (
        <ul className="monitor-list">
          {status.monitors.map((m) => (
            <li key={m.id} className="card status-monitor">
              <div className="status-monitor-head">
                <strong>{m.name}</strong>
                <span className="status-monitor-side">
                  {m.uptime90dPct !== null && (
                    <span className="muted small">{m.uptime90dPct}% uptime (90 days)</span>
                  )}
                  <StatusBadge status={m.status} />
                </span>
              </div>
              <UptimeBars days={m.days} />
            </li>
          ))}
        </ul>
      )}

      <section className="card">
        <h2>Incidents in the last 14 days</h2>
        {status.incidents.length === 0 ? (
          <p className="muted">No incidents.</p>
        ) : (
          <ul className="incident-list">
            {status.incidents.map((i) => (
              <li
                key={`${i.monitorName}-${i.startedAt}`}
                className={i.resolvedAt ? "incident" : "incident incident-open"}
              >
                <div className="incident-head">
                  <span className={`badge ${i.resolvedAt ? "badge-up" : "badge-down"}`}>
                    <span aria-hidden="true">{i.resolvedAt ? "✓" : "✕"}</span>{" "}
                    {i.resolvedAt ? "Resolved" : "Ongoing"}
                  </span>
                  <strong>{i.monitorName}</strong>
                </div>
                <p className="small incident-detail">
                  Started {timeLabel(i.startedAt)}
                  {i.durationSec !== null && ` · lasted ${formatDuration(i.durationSec)}`}
                </p>
                {i.note && <p className="small incident-note">{i.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted small center">
        Checked every 5 minutes. History is updated hourly. Last updated{" "}
        {timeLabel(status.generatedAt)}.
      </p>
    </main>
  );
}
