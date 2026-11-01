import { STATUS_LABEL, type MonitorStatus } from "@/lib/format";

// A symbol as well as a colour, so status never depends on colour alone (WCAG 1.4.1).
const SYMBOL: Record<MonitorStatus, string> = {
  pending: "○",
  up: "●",
  failing: "▲",
  down: "✕",
  recovering: "◐",
  paused: "❚❚",
};

export function StatusBadge({ status }: { status: MonitorStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{SYMBOL[status]}</span> {STATUS_LABEL[status]}
    </span>
  );
}
