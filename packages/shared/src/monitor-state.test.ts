import { describe, expect, it } from "vitest";
import { INITIAL_STATE, nextState, type MonitorState, type StateEvent } from "./monitor-state.js";

const OK = { ok: true };
const FAIL = { ok: false };

/** Feeds a sequence of outcomes through the machine, one per minute from 00:00. */
function run(outcomes: { ok: boolean }[], threshold = 3, start: MonitorState = INITIAL_STATE) {
  let state = start;
  const events: StateEvent[] = [];
  outcomes.forEach((outcome, i) => {
    const at = `2026-11-01T00:${String(i).padStart(2, "0")}:00.000Z`;
    const step = nextState(state, outcome, threshold, at);
    state = step.state;
    if (step.event) events.push(step.event);
  });
  return { state, events };
}

describe("nextState", () => {
  it("goes from pending to up on the first success", () => {
    expect(run([OK]).state.status).toBe("up");
  });

  it("marks a single failure as failing without opening an incident", () => {
    const { state, events } = run([OK, FAIL]);
    expect(state).toMatchObject({ status: "failing", consecutiveFailures: 1 });
    expect(events).toEqual([]);
  });

  it("treats a blip followed by a success as no incident", () => {
    const { state, events } = run([FAIL, FAIL, OK]);
    expect(state).toMatchObject({ status: "up", firstFailureAt: null });
    expect(events).toEqual([]);
  });

  it("opens an incident on the Nth consecutive failure, starting at the first failure", () => {
    const { state, events } = run([OK, FAIL, FAIL, FAIL]);
    expect(state.status).toBe("down");
    expect(events).toEqual([{ type: "incident_opened", startedAt: "2026-11-01T00:01:00.000Z" }]);
  });

  it("opens once, however long the outage lasts", () => {
    const { events } = run([FAIL, FAIL, FAIL, FAIL, FAIL, FAIL]);
    expect(events.filter((e) => e.type === "incident_opened")).toHaveLength(1);
  });

  it("respects a threshold of 1", () => {
    expect(run([FAIL], 1).events).toHaveLength(1);
  });

  it("needs two successes to resolve, timed from the first success", () => {
    const { state, events } = run([FAIL, FAIL, FAIL, OK, OK]);
    expect(state.status).toBe("up");
    expect(events[1]).toEqual({
      type: "incident_resolved",
      startedAt: "2026-11-01T00:00:00.000Z",
      resolvedAt: "2026-11-01T00:04:00.000Z",
    });
  });

  it("keeps the incident open if it fails again while recovering", () => {
    const { state, events } = run([FAIL, FAIL, FAIL, OK, FAIL, OK]);
    expect(state.status).toBe("recovering");
    expect(state.firstFailureAt).toBe("2026-11-01T00:00:00.000Z");
    expect(events.map((e) => e.type)).toEqual(["incident_opened"]);
  });

  it("produces exactly one open and one resolve for a flapping outage", () => {
    const { events } = run([FAIL, FAIL, FAIL, OK, FAIL, OK, OK, OK]);
    expect(events.map((e) => e.type)).toEqual(["incident_opened", "incident_resolved"]);
  });
});
