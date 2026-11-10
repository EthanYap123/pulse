import { signRequest, type CheckerMonitor } from "@pulse/shared";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type ShardClient } from "../src/routes.js";
import type { StatusSnapshot } from "../src/status.js";
import { monitor } from "./helpers.js";

const SECRET = "router-test-secret";
const M1 = "00000000-0000-4000-8000-000000000001";
const M2 = "00000000-0000-4000-8000-000000000002";

const SNAPSHOT: StatusSnapshot = {
  projectId: "00000000-0000-4000-8000-000000000099",
  builtAt: "2026-11-04T12:00:00.000Z",
  project: { name: "Site", slug: "site", note: null },
  monitors: [
    {
      id: M1,
      name: "API",
      status: "pending",
      uptime90dPct: null,
      days: [],
      shard: 1,
      isPaused: false,
    },
    {
      id: M2,
      name: "Web",
      status: "paused",
      uptime90dPct: null,
      days: [],
      shard: 4,
      isPaused: true,
    },
  ],
  incidents: [],
};

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
  const snapshots = {
    get: vi.fn((slug: string) => Promise.resolve(slug === "site" ? SNAPSHOT : null)),
    runHourly: vi.fn(() => Promise.resolve()),
    refreshProjects: vi.fn((_ids: string[]) => Promise.resolve()),
  };
  const handle = createRouter({
    shardCount: 5,
    shard: (i) => shards[i]!,
    snapshots,
    hmacSecret: secret ?? undefined,
    environment: "test",
    commit: "test",
  });
  return { handle, shards, snapshots };
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
    expect(await res.json()).toEqual({ status: "ok", environment: "test", commit: "test" });
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

describe("public status endpoint", () => {
  const get = (slug: string) => new Request(`https://checker.test/public/v1/status/${slug}`);

  it("merges live status into the snapshot, needing no signature, and can be cached", async () => {
    const { handle, shards } = setup(null); // works even with the internal API off
    const res = await handle(get("site"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const page = (await res.json()) as { overall: string; monitors: { status: string }[] };
    expect(page.monitors.map((m) => m.status)).toEqual(["up", "paused"]);
    expect(page.overall).toBe("operational");
    // Paused monitors aren't asked about.
    expect(shards[1]!.live).toHaveBeenCalledWith([M1]);
    expect(shards[4]!.live).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or private project", async () => {
    const { handle } = setup();
    expect((await handle(get("nobody"))).status).toBe(404);
  });

  it("still answers when a shard fails", async () => {
    const { handle, shards } = setup();
    shards[1]!.live.mockRejectedValueOnce(new Error("shard down"));
    const res = await handle(get("site"));
    const page = (await res.json()) as { monitors: { status: string }[] };
    expect(res.status).toBe(200);
    expect(page.monitors[0]?.status).toBe("pending");
  });

  it("rejects slugs that can't exist without asking the store", async () => {
    const { handle, snapshots } = setup();
    expect((await handle(get("Bad_Slug"))).status).toBe(404);
    expect(snapshots.get).not.toHaveBeenCalled();
  });
});

describe("snapshot maintenance", () => {
  it("refreshes projects on a signed request", async () => {
    const { handle, snapshots } = setup();
    const projectIds = [M1];
    const res = await handle(
      await signed("POST", "/internal/v1/snapshots/refresh", { projectIds }),
    );
    expect(res.status).toBe(204);
    expect(snapshots.refreshProjects).toHaveBeenCalledWith(projectIds);
  });

  it("requires a signature and valid ids", async () => {
    const { handle } = setup();
    const path = "/internal/v1/snapshots/refresh";
    const unsigned = new Request(`https://checker.test${path}`, { method: "POST" });
    expect((await handle(unsigned)).status).toBe(401);
    expect((await handle(await signed("POST", path, { projectIds: ["nope"] }))).status).toBe(422);
  });

  it("runs the hourly job after a flush", async () => {
    const { handle, snapshots } = setup();
    await handle(await signed("POST", "/internal/v1/flush"));
    expect(snapshots.runHourly).toHaveBeenCalled();
  });
});
