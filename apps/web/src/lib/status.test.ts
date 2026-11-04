import { describe, expect, it } from "vitest";
import { dayLabel, dayReadout, daysSummary, timeLabel } from "./status.js";

describe("labels", () => {
  it("formats in UTC whatever the machine's time zone", () => {
    expect(dayLabel("2026-11-03")).toBe("3 Nov 2026");
    expect(timeLabel("2026-11-03T14:05:00.000Z")).toBe("3 Nov, 14:05 UTC");
  });

  it("describes one day", () => {
    expect(dayReadout({ day: "2026-11-03", uptimePct: 91.5 })).toBe("3 Nov 2026: 91.5% uptime");
    expect(dayReadout({ day: "2026-11-03", uptimePct: null })).toBe("3 Nov 2026: no data");
  });
});

describe("daysSummary", () => {
  const day = (d: number, uptimePct: number | null) => ({
    day: `2026-11-${String(d).padStart(2, "0")}`,
    uptimePct,
  });

  it("says when nothing has been recorded", () => {
    expect(daysSummary([day(1, null), day(2, null)])).toBe("No checks recorded yet.");
  });

  it("says when there was no downtime, ignoring days without data", () => {
    expect(daysSummary([day(1, null), day(2, 100)])).toBe(
      "No downtime recorded in the last 90 days.",
    );
  });

  it("counts bad days and names the worst", () => {
    expect(daysSummary([day(1, 100), day(2, 99.5), day(3, 80)])).toBe(
      "Downtime on 2 days. Lowest: 3 Nov 2026: 80% uptime.",
    );
    expect(daysSummary([day(2, 99.5)])).toBe(
      "Downtime on 1 day. Lowest: 2 Nov 2026: 99.5% uptime.",
    );
  });
});
