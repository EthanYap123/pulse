import type { CheckOutcome } from "./check.js";

/** Consecutive successes needed to close an incident (docs/ARCHITECTURE.md §3.3). */
export const RECOVERY_SUCCESSES = 2;

export type MonitorStatus = "pending" | "up" | "failing" | "down" | "recovering";

export type MonitorState = {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** Time of the first failure in the current run of failures; an incident starts here. */
  firstFailureAt: string | null;
};

export type StateEvent =
  | { type: "incident_opened"; startedAt: string }
  | { type: "incident_resolved"; startedAt: string; resolvedAt: string };

export const INITIAL_STATE: MonitorState = {
  status: "pending",
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  firstFailureAt: null,
};

/**
 * The monitor state machine. Pure, so the checker, tests and any future replay all agree.
 * `threshold` is the number of consecutive failures that opens an incident.
 */
export function nextState(
  state: MonitorState,
  outcome: Pick<CheckOutcome, "ok">,
  threshold: number,
  at: string,
): { state: MonitorState; event?: StateEvent } {
  const isIncidentOpen = state.status === "down" || state.status === "recovering";

  if (outcome.ok) {
    const successes = state.consecutiveSuccesses + 1;
    if (isIncidentOpen) {
      if (successes >= RECOVERY_SUCCESSES) {
        return {
          state: {
            status: "up",
            consecutiveFailures: 0,
            consecutiveSuccesses: successes,
            firstFailureAt: null,
          },
          event: {
            type: "incident_resolved",
            startedAt: state.firstFailureAt ?? at,
            resolvedAt: at,
          },
        };
      }
      return {
        state: {
          ...state,
          status: "recovering",
          consecutiveSuccesses: successes,
          consecutiveFailures: 0,
        },
      };
    }
    return {
      state: {
        status: "up",
        consecutiveFailures: 0,
        consecutiveSuccesses: successes,
        firstFailureAt: null,
      },
    };
  }

  const failures = state.consecutiveFailures + 1;
  if (isIncidentOpen) {
    // Still down, or a failure while recovering: the incident stays open with its start time.
    return {
      state: { ...state, status: "down", consecutiveFailures: failures, consecutiveSuccesses: 0 },
    };
  }
  const firstFailureAt = state.firstFailureAt ?? at;
  if (failures >= threshold) {
    return {
      state: {
        status: "down",
        consecutiveFailures: failures,
        consecutiveSuccesses: 0,
        firstFailureAt,
      },
      event: { type: "incident_opened", startedAt: firstFailureAt },
    };
  }
  return {
    state: {
      status: "failing",
      consecutiveFailures: failures,
      consecutiveSuccesses: 0,
      firstFailureAt,
    },
  };
}
