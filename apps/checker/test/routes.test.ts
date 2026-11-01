import { signRequest, type CheckerMonitor } from "@pulse/shared";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type ShardClient } from "../src/routes.js";
import { monitor } from "./helpers.js";

const SECRET = "router-test-secret";

/** `null` means no secret is configured. */
function setup(secret: string | null = SECRET) {
  const shards = Array.from({ length: 5 }, () => ({
    upsert: vi.fn((_m: CheckerMonitor) => Promise.resolve()),
    remove: vi.fn((_id: string) => Promise.resolve()),
    live: vi.fn((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          monitorId: id,
          status: "up" as const,
          lastCheckedAt: null,
          lastLatencyMs: 12,
        })),
      ),
    ),
    flush: vi.fn(() => Promise.resolve({ flushed: 3 })),
  })) satisfies ShardClient[];
  const handle = createRouter({
    shardCount: 5,
    shard: (i) => shards[i]!,
    hmacSecret: secret ?? undefined,
    environment: "test",
  });
  return { handle, shards };
}

async function signed(method: string, path: string, body?: unknown, secret = SECRET) {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = await signRequest(secret, method, path, text);
  return new Request(`https://checker.test${path}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: text || undefined,
  });
}

describe("checker routes", () => {
  it("answers /health without auth", async () => {
    const { handle } = setup();
    const res = await handle(new Request("https://checker.test/health"));
    expect(await res.json()).toEqual({ status: "ok", environment: "test" });
  });

  it("rejects unsigned and wrongly signed internal requests", async () => {
    const { handle, shards } = setup();
    const unsigned = await handle(
      new Request("https://checker.test/internal/v1/flush", { method: "POST" }),
    );
    expect(unsigned.status).toBe(401);
    const wrong = await handle(await signed("POST", "/internal/v1/flush", undefined, "other"));
    expect(wrong.status).toBe(401);
    expect(shards[0]!.flush).not.toHaveBeenCalled();
  });

  it("is disabled when no secret is configured", async () => {
    const { handle } = setup(null);
    const res = await handle(await signed("POST", "/internal/v1/flush"));
    expect(res.status).toBe(503);
  });

  it("routes a sync to the monitor's shard", async () => {
    const { handle, shards } = setup();
    const m = monitor({ shard: 3 });
    const res = await handle(await signed("POST", "/internal/v1/monitors/sync", { monitor: m }));
    expect(res.status).toBe(204);
    expect(shards[3]!.upsert).toHaveBeenCalledWith(m);
  });

  it("refuses a sync for a shard that doesn't exist", async () => {
    const { handle } = setup();
    const body = { monitor: monitor({ shard: 9 }) };
    expect((await handle(await signed("POST", "/internal/v1/monitors/sync", body))).status).toBe(
      422,
    );
  });

  it("routes a delete using the shard in the query string", async () => {
    const { handle, shards } = setup();
    const id = monitor().id;
    const res = await handle(await signed("DELETE", `/internal/v1/monitors/${id}?shard=2`));
    expect(res.status).toBe(204);
    expect(shards[2]!.remove).toHaveBeenCalledWith(id);
  });

  it("gathers live status from each shard involved", async () => {
    const { handle, shards } = setup();
    const a = "00000000-0000-4000-8000-00000000000a";
    const b = "00000000-0000-4000-8000-00000000000b";
    const res = await handle(
      await signed("POST", "/internal/v1/live", {
        monitors: [
          { id: a, shard: 1 },
          { id: b, shard: 4 },
        ],
      }),
    );
    const body = (await res.json()) as { items: { monitorId: string }[] };
    expect(body.items.map((i) => i.monitorId).sort()).toEqual([a, b]);
    expect(shards[1]!.live).toHaveBeenCalledWith([a]);
    expect(shards[0]!.live).not.toHaveBeenCalled();
  });

  it("flushes every shard", async () => {
    const { handle } = setup();
    const res = await handle(await signed("POST", "/internal/v1/flush"));
    expect(await res.json()).toEqual({ flushed: 15 });
  });
});
