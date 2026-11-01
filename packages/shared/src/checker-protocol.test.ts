import { describe, expect, it } from "vitest";
import { signRequest, verifyRequest } from "./checker-protocol.js";

const SECRET = "shared-secret-for-tests";
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);

async function signed(method = "POST", path = "/internal/v1/monitors/sync", body = '{"a":1}') {
  const h = await signRequest(SECRET, method, path, body, NOW);
  return { timestamp: h["x-pulse-timestamp"] ?? null, signature: h["x-pulse-signature"] ?? null };
}

describe("request signing", () => {
  it("verifies a request signed with the same secret", async () => {
    const headers = await signed();
    expect(
      await verifyRequest(SECRET, "POST", "/internal/v1/monitors/sync", '{"a":1}', headers, NOW),
    ).toBe(true);
  });

  it("rejects a changed body, path or method", async () => {
    const headers = await signed();
    const path = "/internal/v1/monitors/sync";
    expect(await verifyRequest(SECRET, "POST", path, '{"a":2}', headers, NOW)).toBe(false);
    expect(await verifyRequest(SECRET, "POST", "/internal/v1/flush", '{"a":1}', headers, NOW)).toBe(
      false,
    );
    expect(await verifyRequest(SECRET, "DELETE", path, '{"a":1}', headers, NOW)).toBe(false);
  });

  it("rejects another secret", async () => {
    const headers = await signed();
    expect(
      await verifyRequest("other", "POST", "/internal/v1/monitors/sync", '{"a":1}', headers, NOW),
    ).toBe(false);
  });

  it("rejects requests older than 5 minutes", async () => {
    const headers = await signed();
    const later = NOW + 301_000;
    expect(
      await verifyRequest(SECRET, "POST", "/internal/v1/monitors/sync", '{"a":1}', headers, later),
    ).toBe(false);
  });

  it("rejects missing headers", async () => {
    expect(
      await verifyRequest(SECRET, "POST", "/x", "", { timestamp: null, signature: null }, NOW),
    ).toBe(false);
  });
});
