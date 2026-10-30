import { z } from "zod";

/** Why a check failed. `null` on a passing check. */
export const checkErrorSchema = z.enum(["status", "timeout", "dns", "tls", "connection"]);
export type CheckError = z.infer<typeof checkErrorSchema>;

export const expectedStatusSchema = z
  .object({
    min: z.number().int().min(100).max(599),
    max: z.number().int().min(100).max(599),
  })
  .refine((range) => range.min <= range.max, { message: "min must be <= max" });
export type ExpectedStatus = z.infer<typeof expectedStatusSchema>;

export const DEFAULT_EXPECTED_STATUS: ExpectedStatus = { min: 200, max: 399 };

/** What the checker observed for one request. */
export type RawCheck =
  | { kind: "response"; statusCode: number; latencyMs: number }
  | { kind: "error"; error: Exclude<CheckError, "status">; latencyMs: number | null };

export type CheckOutcome = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: CheckError | null;
};

export function isExpectedStatus(statusCode: number, expected: ExpectedStatus): boolean {
  return statusCode >= expected.min && statusCode <= expected.max;
}

/**
 * Turns what the checker saw into a pass/fail outcome. A response outside the
 * expected range fails with `status`; a request that never got a response keeps
 * its network error and has no status code.
 */
export function classifyCheck(
  raw: RawCheck,
  expected: ExpectedStatus = DEFAULT_EXPECTED_STATUS,
): CheckOutcome {
  if (raw.kind === "error") {
    return { ok: false, statusCode: null, latencyMs: raw.latencyMs, error: raw.error };
  }
  const ok = isExpectedStatus(raw.statusCode, expected);
  return {
    ok,
    statusCode: raw.statusCode,
    latencyMs: raw.latencyMs,
    error: ok ? null : "status",
  };
}
