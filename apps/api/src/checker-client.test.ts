import { verifyRequest } from "@pulse/shared";
import { describe, expect, it, vi } from "vitest";
import { createCheckerClient } from "./checker-client.js";

const SECRET = "client-test-secret";
const MONITOR = {
  id: "00000000-0000-4000-8000-000000000001",
  shard: 2,
  url: "https://example.com/",
  method: "GET" as const,
  expectedStatus: { min: 200, max: 399 },
  timeoutMs: 8000,
  failureThreshold: 3,
  encryptedHeaders: {},
  isPaused: false,
};

function recordingFetch(response: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response());
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("checker client", () => {
  it("signs requests so the checker can verify them", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const client = createCheckerClient({ url: "https://checker.test/", secret: SECRET, fetch });
    expect(await client.sync(MONITOR)).toBe(true);

    const { url, init } = calls[0]!;
    expect(url).toBe("https://checker.test/internal/v1/monitors/sync");
    const headers = init.headers as Record<string, string>;
    const valid = await verifyRequest(
      SECRET,
      "POST",
      "/internal/v1/monitors/sync",
      init.body as string,
      { timestamp: headers["x-pulse-timestamp"]!, signature: headers["x-pulse-signature"]! },
    );
    expect(valid).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ monitor: MONITOR });
  });

  it("puts the shard in the delete URL", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const client = createCheckerClient({ url: "https://checker.test", secret: SECRET, fetch });
    await client.remove(MONITOR.id, 2);
    expect(calls[0]?.url).toBe(`https://checker.test/internal/v1/monitors/${MONITOR.id}?shard=2`);
    expect(calls[0]?.init.method).toBe("DELETE");
  });

  it("returns live status keyed by monitor id", async () => {
    const item = { monitorId: MONITOR.id, status: "up", lastCheckedAt: null, lastLatencyMs: 80 };
    const { fetch } = recordingFetch(() => Response.json({ items: [item] }));
    const client = createCheckerClient({ url: "https://checker.test", secret: SECRET, fetch });
    const live = await client.live([{ id: MONITOR.id, shard: 2 }]);
    expect(live?.get(MONITOR.id)).toEqual(item);
  });

  it("asks for status pages to be refreshed", async () => {
    const { fetch, calls } = recordingFetch(() => new Response(null, { status: 204 }));
    const client = createCheckerClient({ url: "https://checker.test", secret: SECRET, fetch });
    expect(await client.refreshStatusPages(["p1"])).toBe(true);
    expect(calls[0]?.url).toBe("https://checker.test/internal/v1/snapshots/refresh");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ projectIds: ["p1"] });
  });

  it("skips the request when there is nothing to ask about", async () => {
    const { fetch, calls } = recordingFetch(() => Response.json({ items: [] }));
    const client = createCheckerClient({ url: "https://checker.test", secret: SECRET, fetch });
    expect((await client.live([]))?.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("reports failure instead of throwing when the checker is down or refuses", async () => {
    const log = vi.fn();
    const down = createCheckerClient({
      url: "https://checker.test",
      secret: SECRET,
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
      log,
    });
    expect(await down.sync(MONITOR)).toBe(false);
    expect(await down.live([{ id: MONITOR.id, shard: 2 }])).toBeNull();

    const { fetch } = recordingFetch(() => new Response(null, { status: 401 }));
    const refused = createCheckerClient({
      url: "https://checker.test",
      secret: SECRET,
      fetch,
      log,
    });
    expect(await refused.remove(MONITOR.id, 2)).toBe(false);
    expect(log).toHaveBeenCalled();
  });
});
