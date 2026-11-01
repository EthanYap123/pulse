import { describe, expect, it } from "vitest";
import { formatMs, timeAgo } from "./format.js";

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
