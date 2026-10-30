import { describe, expect, it } from "vitest";
import { classifyCheck, expectedStatusSchema, isExpectedStatus } from "./check.js";

describe("isExpectedStatus", () => {
  it("includes both ends of the range", () => {
    expect(isExpectedStatus(200, { min: 200, max: 299 })).toBe(true);
    expect(isExpectedStatus(299, { min: 200, max: 299 })).toBe(true);
  });

  it("rejects codes outside the range", () => {
    expect(isExpectedStatus(199, { min: 200, max: 299 })).toBe(false);
    expect(isExpectedStatus(300, { min: 200, max: 299 })).toBe(false);
  });
});

describe("classifyCheck", () => {
  it("passes a 2xx response with the default range", () => {
    expect(classifyCheck({ kind: "response", statusCode: 204, latencyMs: 120 })).toEqual({
      ok: true,
      statusCode: 204,
      latencyMs: 120,
      error: null,
    });
  });

  it("passes a redirect with the default range", () => {
    expect(classifyCheck({ kind: "response", statusCode: 301, latencyMs: 80 }).ok).toBe(true);
  });

  it("fails a 5xx response with a status error", () => {
    expect(classifyCheck({ kind: "response", statusCode: 503, latencyMs: 40 })).toEqual({
      ok: false,
      statusCode: 503,
      latencyMs: 40,
      error: "status",
    });
  });

  it("uses a custom expected range", () => {
    const expected = { min: 401, max: 401 };
    expect(classifyCheck({ kind: "response", statusCode: 401, latencyMs: 10 }, expected).ok).toBe(
      true,
    );
    expect(classifyCheck({ kind: "response", statusCode: 200, latencyMs: 10 }, expected).ok).toBe(
      false,
    );
  });

  it("keeps the network error and drops the status code", () => {
    expect(classifyCheck({ kind: "error", error: "timeout", latencyMs: null })).toEqual({
      ok: false,
      statusCode: null,
      latencyMs: null,
      error: "timeout",
    });
  });
});

describe("expectedStatusSchema", () => {
  it("accepts a valid range", () => {
    expect(expectedStatusSchema.safeParse({ min: 200, max: 399 }).success).toBe(true);
  });

  it("rejects min above max", () => {
    expect(expectedStatusSchema.safeParse({ min: 400, max: 200 }).success).toBe(false);
  });

  it("rejects codes outside 100-599", () => {
    expect(expectedStatusSchema.safeParse({ min: 99, max: 200 }).success).toBe(false);
  });
});
