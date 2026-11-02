"use client";

import { CAUSE_LABEL, formatDuration, timeAgo } from "@/lib/format";
import type { Incident } from "@/lib/types";

type Props = {
  incidents: Incident[];
  onEditNote: (incident: Incident) => void;
};

/** A project's incidents, newest first, with cause, duration and the owner's note. */
export function IncidentList({ incidents, onEditNote }: Props) {
  if (incidents.length === 0) {
    return <p className="muted">No incidents. Monitors open one after repeated failed checks.</p>;
  }
  return (
    <ul className="incident-list">
      {incidents.map((i) => {
        const open = i.resolvedAt === null;
        return (
          <li key={i.id} className={open ? "incident incident-open" : "incident"}>
            <div className="incident-head">
              <span className={`badge ${open ? "badge-down" : "badge-up"}`}>
                <span aria-hidden="true">{open ? "✕" : "✓"}</span> {open ? "Ongoing" : "Resolved"}
              </span>
              <strong>{i.monitorName}</strong>
              <span className="muted small">
                started {timeAgo(i.startedAt)} ({new Date(i.startedAt).toLocaleString()})
              </span>
            </div>
            <p className="small incident-detail">
              {CAUSE_LABEL[i.cause] ?? i.cause}
              {i.lastStatusCode !== null && ` (HTTP ${i.lastStatusCode})`}
              {i.durationSec !== null && ` · lasted ${formatDuration(i.durationSec)}`}
              {i.resolveReason === "paused" && " · ended because the monitor was paused"}
            </p>
            {i.note && <p className="small incident-note">{i.note}</p>}
            <button
              type="button"
              className="button button-quiet button-small"
              onClick={() => onEditNote(i)}
            >
              {i.note ? "Edit note" : "Add note"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
