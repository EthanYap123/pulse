import { describe, expect, it } from "vitest";
import { overallStatus, uptimePct, uptimeTier } from "./status-page.js";

describe("overallStatus", () => {
  it.each([
    [["up", "down", "failing"], "outage"],
    [["up", "failing"], "degraded"],
    [["up", "recovering"], "degraded"],
    [["up", "up"], "operational"],
    [["up", "paused"], "operational"],
    [["up", "pending"], "operational"],
    [["paused"], "operational"],
    [["pending"], "unknown"],
    [[], "unknown"],
  ] as const)("%j -> %s", (statuses, expected) => {
    expect(overallStatus([...statuses])).toBe(expected);
  });
});

describe("uptimeTier", () => {
  it.each([
    [null, "none"],
    [100, "perfect"],
    [99.99, "good"],
    [99, "good"],
    [98.9, "degraded"],
    [95, "degraded"],
    [94.9, "poor"],
    [0, "poor"],
  ])("%s -> %s", (pct, expected) => {
    expect(uptimeTier(pct)).toBe(expected);
  });
});

describe("uptimePct", () => {
  it("has no value without checks", () => {
    expect(uptimePct(0, 0)).toBeNull();
  });

  it("uses 2 decimals", () => {
    expect(uptimePct(3, 1)).toBe(66.66);
    expect(uptimePct(288, 0)).toBe(100);
  });

  it("never shows 100% when a check failed", () => {
    expect(uptimePct(1_000_000, 1)).toBe(99.99);
  });
});
