import { describe, expect, it } from "vitest";
import { formatDuration, formatMs, timeAgo } from "./format.js";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

describe("timeAgo", () => {
  it.each([
    [null, "never"],
    ["2026-11-01T11:59:30Z", "just now"],
    ["2026-11-01T11:56:00Z", "4 min ago"],
    ["2026-11-01T09:00:00Z", "3 h ago"],
  ])("%s -> %s", (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected);
  });
});

describe("formatMs", () => {
  it("shows a dash when there is no latency", () => {
    expect(formatMs(null)).toBe("–");
    expect(formatMs(120)).toBe("120 ms");
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45 s"],
    [12 * 60, "12 min"],
    [3 * 3600, "3 h"],
    [3 * 3600 + 5 * 60, "3 h 5 min"],
    [2 * 86_400, "2 d"],
    [2 * 86_400 + 4 * 3600, "2 d 4 h"],
  ])("%i s -> %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
