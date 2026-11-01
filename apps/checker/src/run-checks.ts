import { classifyCheck, type CheckError, type ExpectedStatus, type RawCheck } from "@pulse/shared";

export const USER_AGENT = "PulseUptimeChecker/1.0 (+https://github.com/EthanYap123/pulse)";

/** Simultaneous outbound connections per invocation on Workers Free. */
export const MAX_CONCURRENCY = 6;

export type CheckJob = {
  monitorId: string;
  url: string;
  method: "GET" | "HEAD";
  timeoutMs: number;
  headers: Record<string, string>;
  expectedStatus: ExpectedStatus;
};

export type CheckResult = {
  monitorId: string;
  checkedAt: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: CheckError | null;
};

export type CheckDeps = {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => number;
};

/**
 * Workers only expose an error message, so the cause is inferred from it. Anything
 * unrecognised counts as a connection failure.
 */
export function classifyFetchError(error: unknown): Exclude<CheckError, "status"> {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out/i.test(message)) {
    return "timeout";
  }
  if (/dns|resolve|not known|ENOTFOUND|no such host/i.test(message)) return "dns";
  if (/tls|ssl|certificate|handshake/i.test(message)) return "tls";
  return "connection";
}

export async function performCheck(job: CheckJob, deps: CheckDeps): Promise<CheckResult> {
  const started = deps.now();
  const checkedAt = new Date(started).toISOString();
  let raw: RawCheck;
  try {
    const response = await deps.fetch(job.url, {
      method: job.method,
      headers: { ...job.headers, "user-agent": USER_AGENT },
      // Each redirect hop would be another subrequest; a 3xx counts as up by default anyway.
      redirect: "manual",
      signal: AbortSignal.timeout(job.timeoutMs),
    });
    const latencyMs = deps.now() - started;
    // Only the status matters. Not reading the body saves CPU, memory and DO duration.
    await response.body?.cancel();
    raw = { kind: "response", statusCode: response.status, latencyMs };
  } catch (error) {
    raw = { kind: "error", error: classifyFetchError(error), latencyMs: null };
  }
  return { monitorId: job.monitorId, checkedAt, ...classifyCheck(raw, job.expectedStatus) };
}

/** Runs every job, at most `concurrency` at a time, and returns results in job order. */
export async function runChecks(
  jobs: CheckJob[],
  deps: CheckDeps,
  concurrency = MAX_CONCURRENCY,
): Promise<CheckResult[]> {
  const results = new Array<CheckResult>(jobs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await performCheck(jobs[index]!, deps);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}
