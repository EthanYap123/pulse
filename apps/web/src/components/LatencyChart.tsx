"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint, HistoryRange } from "@/lib/types";

type Row = { t: number; latency: number | null; p95: number | null; failed: number | null };

function toRows(points: HistoryPoint[]): Row[] {
  return points.map((p) => ({
    t: new Date(p.t).getTime(),
    // Failed checks are gaps in the line, marked separately, never drawn as 0 ms (US-07).
    latency: p.ok ? (p.latencyMs ?? null) : null,
    p95: p.p95Ms ?? null,
    failed: p.ok ? null : 0,
  }));
}

function tickLabel(range: HistoryRange) {
  return (t: number) =>
    range === "24h"
      ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function LatencyChart({ points, range }: { points: HistoryPoint[]; range: HistoryRange }) {
  if (points.length === 0) {
    return (
      <p className="chart-empty muted">
        No checks yet for this range. Results reach the chart within an hour of each check.
      </p>
    );
  }
  const rows = toRows(points);
  const format = tickLabel(range);
  return (
    <div className="chart" role="img" aria-label={`Response time over the last ${range}`}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={format}
            stroke="var(--muted)"
            fontSize={12}
          />
          <YAxis unit=" ms" stroke="var(--muted)" fontSize={12} width={64} />
          <Tooltip
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(value, name) =>
              name === "failed" ? ["failed", "Check"] : [`${String(value)} ms`, String(name)]
            }
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          />
          <Line
            type="monotone"
            dataKey="latency"
            name={range === "24h" ? "Latency" : "Average"}
            stroke="var(--accent)"
            dot={false}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
          />
          {range !== "24h" && (
            <Line
              type="monotone"
              dataKey="p95"
              name="p95"
              stroke="var(--muted)"
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Scatter dataKey="failed" name="failed" fill="var(--down)" shape="cross" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
