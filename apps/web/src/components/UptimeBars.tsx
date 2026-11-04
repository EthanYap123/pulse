"use client";

import { uptimeTier, type UptimeDay } from "@pulse/shared";
import { useState } from "react";
import { dayReadout, daysSummary } from "@/lib/status";

/**
 * One bar per UTC day, oldest first. Pointing at (or tapping, or tabbing to) a day shows it
 * below; the sentence there means the history never depends on seeing the colours. Only days
 * with downtime take keyboard focus, so nobody has to tab through 90 stops.
 */
export function UptimeBars({ days }: { days: UptimeDay[] }) {
  const [active, setActive] = useState<UptimeDay | null>(null);
  return (
    <div>
      <div className="bars" onMouseLeave={() => setActive(null)}>
        {days.map((d) => {
          const tier = uptimeTier(d.uptimePct);
          const hasDowntime = tier === "good" || tier === "degraded" || tier === "poor";
          return (
            <button
              key={d.day}
              type="button"
              className={`bar bar-${tier}`}
              tabIndex={hasDowntime ? 0 : -1}
              aria-hidden={hasDowntime ? undefined : true}
              aria-label={hasDowntime ? dayReadout(d) : undefined}
              onMouseEnter={() => setActive(d)}
              onFocus={() => setActive(d)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(d)}
            />
          );
        })}
      </div>
      <div className="bars-axis muted small" aria-hidden="true">
        <span>90 days ago</span>
        <span>Today</span>
      </div>
      <p className="small bars-readout" aria-live="polite">
        {active ? dayReadout(active) : daysSummary(days)}
      </p>
    </div>
  );
}
