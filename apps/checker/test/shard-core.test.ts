import { LIMITS } from "@pulse/shared";
import { describe, expect, it, vi } from "vitest";
import { createDecrypt } from "../src/crypto.js";
import { ShardCore, type ShardDeps } from "../src/shard-core.js";
import { ENCRYPTED_FIXTURE, FIXTURE_KEY, fakeDb, idFor, memorySql, monitor } from "./helpers.js";

// 12:05 UTC: an ordinary tick. 13:00 UTC: an hourly flush tick.
const TICK = Date.UTC(2026, 10, 1, 12, 5);
const HOURLY = Date.UTC(2026, 10, 1, 13, 0);

function setup(
  options: { status?: number | ((url: string) => number); db?: ReturnType<typeof fakeDb> } = {},
) {
  const db = options.db ?? fakeDb();
  const statusFor = (url: string) =>
    typeof options.status === "function" ? options.status(url) : (options.status ?? 200);
  const fetch = vi.fn((url: string) =>
    Promise.resolve({ status: statusFor(url), body: null } as unknown as Response),
  );
  let clock = TICK;
  const log = vi.fn();
  const deps: ShardDeps = {
    shard: 0,
    fetch,
    now: () => (clock += 10),
    openDb: db.open,
    decrypt: null,
    log,
  };
  const core = new ShardCore(memorySql(), deps);
  /** Adds monitors to Postgres (the source of truth) and to the shard. */
  const seed = (...monitors: ReturnType<typeof monitor>[]) => {
    db.state.monitors.push(...monitors);
    for (const m of monitors) core.upsert(m);
  };
  return { core, db, fetch, log, deps, seed };
}

describe("ShardCore config", () => {
  it("adds, updates and removes monitors", () => {
    const { core } = setup();
    core.upsert(monitor({ url: "https://a.example/" }));
    core.upsert(monitor({ url: "https://b.example/" }));
    expect(core.monitors().map((m) => m.url)).toEqual(["https://b.example/"]);
    core.remove(monitor().id);
    expect(core.monitors()).toEqual([]);
  });

  it("replaceAll makes the shard match Postgres", () => {
    const { core } = setup();
    core.upsert(monitor({ id: idFor(1) }));
    core.upsert(monitor({ id: idFor(2) }));
    core.replaceAll([
      monitor({ id: idFor(2), url: "https://new.example/" }),
      monitor({ id: idFor(3) }),
    ]);
    expect(core.monitors().map((m) => [m.id, m.url])).toEqual([
      [idFor(2), "https://new.example/"],
      [idFor(3), "https://example.com/"],
    ]);
  });
});

describe("ShardCore.tick", () => {
  it("loads config from Postgres the first time, then checks and buffers results", async () => {
    const db = fakeDb([monitor({ id: idFor(1) }), monitor({ id: idFor(2) })]);
    const { core, fetch } = setup({ db });
    const result = await core.tick(TICK);
    expect(result).toEqual({
      kind: "done",
      checked: 2,
      flushed: null,
      overCap: 0,
      incidentEventsWritten: 0,
      alertsSent: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(core.pendingResults()).toBe(2);
    // Nothing written to Postgres until the hourly flush.
    expect(db.state.results).toEqual([]);
  });

  it("only reconciles from Postgres once, not on every tick", async () => {
    const db = fakeDb([monitor()]);
    const { core } = setup({ db });
    await core.tick(TICK);
    await core.tick(TICK + 5 * 60_000);
    expect(db.state.opened).toBe(1);
  });

  it("skips paused monitors and reports them as paused", async () => {
    const { core, fetch, seed } = setup();
    seed(monitor({ id: idFor(1), isPaused: true }));
    seed(monitor({ id: idFor(2) }));
    await core.tick(TICK);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(core.live([idFor(1)])).toEqual([
      { monitorId: idFor(1), status: "paused", lastCheckedAt: null, lastLatencyMs: null },
    ]);
  });

  it("checks at most 40 monitors per tick", async () => {
    const { core, fetch, log, seed } = setup();
    for (let i = 0; i < 45; i++) seed(monitor({ id: idFor(i) }));
    const result = await core.tick(TICK);
    expect(fetch).toHaveBeenCalledTimes(LIMITS.checksPerShardTick);
    expect(result).toMatchObject({ checked: 40, overCap: 5 });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "shard over its per-tick cap" }),
    );
  });

  it("tracks state across ticks and goes down after the failure threshold", async () => {
    const { core, seed } = setup({ status: 500 });
    seed(monitor({ failureThreshold: 2 }));
    await core.tick(TICK);
    expect(core.live([monitor().id])[0]?.status).toBe("failing");
    await core.tick(TICK + 5 * 60_000);
    expect(core.live([monitor().id])[0]?.status).toBe("down");
  });

  it("skips a tick while the previous one is still running", async () => {
    const { core, seed } = setup();
    seed(monitor());
    const first = core.tick(TICK);
    const second = await core.tick(TICK);
    expect(second).toEqual({ kind: "skipped", reason: "tick_in_progress" });
    await first;
  });

  it("decrypts header values before checking", async () => {
    const { core, fetch, deps, seed } = setup();
    (deps as { decrypt: unknown }).decrypt = await createDecrypt(FIXTURE_KEY);
    seed(
      monitor({
        encryptedHeaders: {
          Authorization: ENCRYPTED_FIXTURE,
        },
      }),
    );
    await core.tick(TICK);
    const init = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].headers).toMatchObject({ Authorization: "Bearer fixture-token" });
  });

  it("skips headers it can't decrypt but still checks the monitor", async () => {
    const { core, fetch, log, seed } = setup();
    seed(monitor({ encryptedHeaders: { "X-Key": "v1.bad.bad.bad" } }));
    await core.tick(TICK);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "no ENCRYPTION_KEY: header skipped" }),
    );
  });
});

describe("ShardCore.flush", () => {
  it("writes buffered results and latest statuses to Postgres on the hourly tick", async () => {
    const db = fakeDb([monitor({ id: idFor(1) })]);
    const { core } = setup({ db });
    await core.tick(TICK);
    const hourly = await core.tick(HOURLY);
    expect(hourly).toMatchObject({ kind: "done", flushed: 2 });
    expect(db.state.results).toHaveLength(2);
    expect(db.state.statuses).toEqual([
      expect.objectContaining({ monitorId: idFor(1), status: "up" }),
    ]);
    expect(core.pendingResults()).toBe(0);
  });

  it("keeps the buffer when Postgres fails, and writes it on the next flush", async () => {
    const db = fakeDb([monitor()]);
    const { core } = setup({ db });
    await core.tick(TICK);
    db.state.failNextInsert = true;
    await expect(core.flush()).rejects.toThrow(/unavailable/);
    expect(core.pendingResults()).toBe(1);
    await core.flush();
    expect(db.state.results).toHaveLength(1);
    expect(core.pendingResults()).toBe(0);
  });

  it("reconciles config after flushing", async () => {
    const db = fakeDb([monitor({ id: idFor(1) })]);
    const { core } = setup({ db });
    await core.tick(TICK);
    db.state.monitors = [monitor({ id: idFor(2) })];
    await core.flush();
    expect(core.monitors().map((m) => m.id)).toEqual([idFor(2)]);
  });
});

describe("ShardCore.live", () => {
  it("returns state for known monitors and skips unknown ones", async () => {
    const { core, seed } = setup();
    seed(monitor());
    await core.tick(TICK);
    const [status, ...rest] = core.live([monitor().id, idFor(99)]);
    expect(rest).toEqual([]);
    expect(status).toMatchObject({ monitorId: monitor().id, status: "up" });
    expect(status?.lastCheckedAt).toEqual(expect.any(String));
    expect(status?.lastLatencyMs).toEqual(expect.any(Number));
  });
});

describe("ShardCore incidents", () => {
  const FIVE_MIN = 5 * 60_000;

  it("writes an opened incident straight away, with the first failure as its start", async () => {
    const db = fakeDb();
    const { core, seed } = setup({ db, status: 503 });
    seed(monitor({ failureThreshold: 2 }));
    await core.tick(TICK);
    expect(db.state.events).toEqual([]);
    await core.tick(TICK + FIVE_MIN);
    expect(db.state.events).toHaveLength(1);
    expect(db.state.events[0]).toMatchObject({
      type: "opened",
      monitorId: monitor().id,
      cause: "status",
      lastStatusCode: 503,
    });
    // The first failure was the 12:05 tick, not the second (threshold) failure.
    expect(db.state.events[0]?.type === "opened" && db.state.events[0].startedAt).toMatch(
      /^2026-11-01T12:05/,
    );
    expect(core.pendingEvents()).toEqual([]);
  });

  it("writes a resolved incident after two successes", async () => {
    const db = fakeDb();
    let status = 503;
    const { core, seed } = setup({ db, status: () => status });
    seed(monitor({ failureThreshold: 1 }));
    await core.tick(TICK);
    status = 200;
    await core.tick(TICK + FIVE_MIN);
    await core.tick(TICK + 2 * FIVE_MIN);
    expect(db.state.events.map((e) => e.type)).toEqual(["opened", "resolved"]);
    expect(db.state.events[1]).toMatchObject({ reason: "recovered" });
  });

  it("keeps events when Postgres is down and writes them in order on a later tick", async () => {
    const db = fakeDb();
    let status = 503;
    const { core, seed } = setup({ db, status: () => status });
    seed(monitor({ failureThreshold: 1 }));
    db.state.failEvents = true;
    await core.tick(TICK);
    status = 200;
    await core.tick(TICK + FIVE_MIN);
    await core.tick(TICK + 2 * FIVE_MIN);
    expect(core.pendingEvents().map((e) => e.type)).toEqual(["opened", "resolved"]);

    db.state.failEvents = false;
    await core.tick(TICK + 3 * FIVE_MIN);
    expect(db.state.events.map((e) => e.type)).toEqual(["opened", "resolved"]);
    expect(core.pendingEvents()).toEqual([]);
  });

  it("doesn't open the database when there is nothing to write", async () => {
    const db = fakeDb([monitor()]);
    const { core } = setup({ db });
    await core.tick(TICK); // first tick reconciles: one open
    await core.tick(TICK + FIVE_MIN);
    expect(db.state.opened).toBe(1);
  });

  it("stays inside the subrequest budget on a full shard", async () => {
    const db = fakeDb();
    const { core, seed } = setup({ db, status: 503 });
    const monitors = Array.from({ length: 40 }, (_, i) =>
      monitor({ id: idFor(i), failureThreshold: 1 }),
    );
    seed(...monitors);
    // 40 checks + 3 flush queries leaves 6 writes (50 - 40 - 3 - 1).
    const result = await core.tick(HOURLY);
    expect(result).toMatchObject({ checked: 40, incidentEventsWritten: 6 });
    expect(core.pendingEvents()).toHaveLength(34);
  });

  it("resolves an open incident as paused, and resets state, when the monitor is paused", async () => {
    const db = fakeDb();
    const { core, seed } = setup({ db, status: 503 });
    seed(monitor({ failureThreshold: 1 }));
    await core.tick(TICK);
    core.upsert(monitor({ failureThreshold: 1, isPaused: true }));
    expect(core.pendingEvents()).toEqual([
      expect.objectContaining({ type: "resolved", reason: "paused" }),
    ]);
    core.upsert(monitor({ failureThreshold: 1, isPaused: false }));
    expect(core.live([monitor().id])[0]?.status).toBe("pending");
  });

  it("drops pending events for a deleted monitor", async () => {
    const db = fakeDb();
    const { core, seed } = setup({ db, status: 503 });
    seed(monitor({ failureThreshold: 1 }));
    db.state.failEvents = true;
    await core.tick(TICK);
    core.remove(monitor().id);
    expect(core.pendingEvents()).toEqual([]);
  });
});

describe("ShardCore status pages", () => {
  it("asks for a refresh when an incident is written, and not otherwise", async () => {
    const db = fakeDb();
    const { core, seed, deps } = setup({ db, status: 503 });
    const refresh = vi.fn((_ids: string[]) => Promise.resolve());
    deps.refreshStatusPages = refresh;
    seed(monitor({ failureThreshold: 2 }));
    await core.tick(TICK);
    expect(refresh).not.toHaveBeenCalled();
    await core.tick(TICK + 5 * 60_000);
    expect(refresh).toHaveBeenCalledWith([monitor().id]);
  });

  it("carries on if the refresh fails", async () => {
    const db = fakeDb();
    const { core, seed, deps } = setup({ db, status: 503 });
    deps.refreshStatusPages = () => Promise.reject(new Error("snapshots down"));
    seed(monitor({ failureThreshold: 1 }));
    await expect(core.tick(TICK)).resolves.toMatchObject({ incidentEventsWritten: 1 });
  });
});
