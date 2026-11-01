import { describe, expect, it, vi } from "vitest";
import {
  USER_AGENT,
  classifyFetchError,
  performCheck,
  runChecks,
  type CheckDeps,
  type CheckJob,
} from "../src/run-checks.js";

const job = (overrides: Partial<CheckJob> = {}): CheckJob => ({
  monitorId: "m1",
  url: "https://example.com/",
  method: "GET",
  timeoutMs: 1000,
  headers: {},
  expectedStatus: { min: 200, max: 399 },
  ...overrides,
});

function respond(status: number, delayMs = 0) {
  const cancel = vi.fn(() => Promise.resolve());
  const fetch = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { status, body: { cancel } } as unknown as Response;
  });
  return { fetch, cancel };
}

function deps(fetch: CheckDeps["fetch"], start = 1_000): CheckDeps {
  let t = start;
  return { fetch, now: () => (t += 50) };
}

describe("performCheck", () => {
  it("records an expected status as ok with latency, and doesn't read the body", async () => {
    const { fetch, cancel } = respond(204);
    const result = await performCheck(job(), deps(fetch));
    expect(result).toMatchObject({ monitorId: "m1", ok: true, statusCode: 204, error: null });
    expect(result.latencyMs).toBe(50);
    expect(cancel).toHaveBeenCalled();
  });

  it("fails on an unexpected status", async () => {
    const result = await performCheck(job(), deps(respond(503).fetch));
    expect(result).toMatchObject({ ok: false, statusCode: 503, error: "status" });
  });

  it("doesn't follow redirects and sends the user agent and custom headers", async () => {
    const { fetch } = respond(301);
    await performCheck(job({ method: "HEAD", headers: { "X-Key": "abc" } }), deps(fetch));
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1]).toMatchObject({
      method: "HEAD",
      redirect: "manual",
      headers: { "X-Key": "abc", "user-agent": USER_AGENT },
    });
  });

  it("times out slow responses", async () => {
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
      });
    });
    const result = await performCheck(job({ timeoutMs: 30 }), deps(fetch));
    expect(result).toMatchObject({
      ok: false,
      statusCode: null,
      latencyMs: null,
      error: "timeout",
    });
  });
});

describe("classifyFetchError", () => {
  it.each([
    [Object.assign(new Error("signal timed out"), { name: "TimeoutError" }), "timeout"],
    [new Error("DNS lookup failed"), "dns"],
    [new Error("getaddrinfo ENOTFOUND nope.invalid"), "dns"],
    [new Error("TLS handshake failed"), "tls"],
    [new Error("certificate has expired"), "tls"],
    [new Error("Network connection lost."), "connection"],
    ["something odd", "connection"],
  ])("%s -> %s", (error, expected) => {
    expect(classifyFetchError(error)).toBe(expected);
  });
});

describe("runChecks", () => {
  it("returns results in job order", async () => {
    const fetch = vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, url.endsWith("slow") ? 20 : 0));
      return { status: 200, body: null } as unknown as Response;
    });
    const jobs = [
      job({ monitorId: "a", url: "https://a/slow" }),
      job({ monitorId: "b", url: "https://b/" }),
    ];
    const results = await runChecks(jobs, deps(fetch));
    expect(results.map((r) => r.monitorId)).toEqual(["a", "b"]);
  });

  it("never runs more than 6 at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch = vi.fn(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: 200, body: null } as unknown as Response;
    });
    const jobs = Array.from({ length: 20 }, (_, i) => job({ monitorId: `m${i}` }));
    const results = await runChecks(jobs, deps(fetch));
    expect(results).toHaveLength(20);
    expect(fetch).toHaveBeenCalledTimes(20);
    expect(peak).toBe(6);
  });

  it("handles no jobs", async () => {
    expect(await runChecks([], deps(respond(200).fetch))).toEqual([]);
  });
});
