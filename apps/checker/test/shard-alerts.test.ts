import { describe, expect, it, vi } from "vitest";
import { createDecrypt } from "../src/crypto.js";
import type { AlertJob, IncidentEvent } from "../src/db.js";
import { ShardCore, type ShardDeps } from "../src/shard-core.js";
import { ENCRYPTED_FIXTURE, FIXTURE_KEY, fakeDb, memorySql, monitor } from "./helpers.js";

const TICK = Date.UTC(2026, 10, 1, 12, 5);
const FIVE_MIN = 5 * 60_000;
// ENCRYPTED_FIXTURE decrypts to this; the fake fetch tells it apart from monitor checks.
const WEBHOOK = "Bearer fixture-token";

/** A delivery Postgres would create for `event` on channel `channelId`. */
function job(event: IncidentEvent, channelId = "chan-1", incidentId = "inc-1"): AlertJob {
  return {
    deliveryId: `${incidentId}:${channelId}:${event.type}`,
    incidentId,
    channelId,
    channelType: "discord",
    secretEnc: ENCRYPTED_FIXTURE,
    message: {
      event: event.type,
      projectName: "Site",
      monitorName: "Home",
      monitorUrl: "https://example.com/",
    },
  };
}

/**
 * A shard with one monitor whose checks fail while `down` is true, and a Discord that
 * answers with `discordStatus`.
 */
async function setup() {
  const db = fakeDb();
  db.state.jobsFor = (event) => [job(event)];
  const control = { down: true, discordStatus: 204, retryAfter: null as string | null };
  const discordCalls: string[] = [];
  let clock = TICK;
  const fetch = vi.fn((url: string, init: RequestInit) => {
    if (url === WEBHOOK) {
      const body = JSON.parse(init.body as string) as { embeds: { title: string }[] };
      discordCalls.push(body.embeds[0]!.title);
      const headers = new Headers(control.retryAfter ? { "retry-after": control.retryAfter } : {});
      return Promise.resolve(new Response(null, { status: control.discordStatus, headers }));
    }
    return Promise.resolve({ status: control.down ? 503 : 200, body: null } as unknown as Response);
  });
  const deps: ShardDeps = {
    shard: 0,
    fetch,
    now: () => clock,
    openDb: db.open,
    decrypt: await createDecrypt(FIXTURE_KEY),
    log: vi.fn(),
  };
  const core = new ShardCore(memorySql(), deps);
  const m = monitor({ failureThreshold: 1 });
  db.state.monitors.push(m);
  core.upsert(m);
  const tick = async () => {
    const result = await core.tick(clock);
    clock += FIVE_MIN;
    return result;
  };
  return { core, db, control, discordCalls, tick };
}

describe("ShardCore alerts", () => {
  it("sends the outage and recovery alerts and records them as sent", async () => {
    const { db, control, discordCalls, tick } = await setup();
    const opened = await tick();
    expect(opened).toMatchObject({ incidentEventsWritten: 1, alertsSent: 1 });
    expect(discordCalls).toEqual(["🔴 Home is down"]);

    control.down = false;
    await tick();
    await tick();
    expect(discordCalls).toEqual(["🔴 Home is down", "🟢 Home is back up"]);
    expect(db.state.deliveryUpdates.map((u) => [u.id, u.state, u.attempts])).toEqual([
      ["inc-1:chan-1:opened", "sent", 1],
      ["inc-1:chan-1:resolved", "sent", 1],
    ]);
  });

  it("retries a failed send with backoff, then sends it", async () => {
    const { core, db, control, discordCalls, tick } = await setup();
    control.discordStatus = 502;
    await tick();
    expect(core.queuedAlerts()).toEqual([
      { deliveryId: "inc-1:chan-1:opened", event: "opened", attempts: 1 },
    ]);
    expect(db.state.deliveryUpdates.at(-1)).toMatchObject({
      state: "pending",
      attempts: 1,
      lastError: "Discord error (502)",
    });

    // The first retry waits 5 minutes: the next tick (exactly 5 min later) is due.
    control.discordStatus = 204;
    await tick();
    expect(discordCalls).toHaveLength(2);
    expect(core.queuedAlerts()).toEqual([]);
    expect(db.state.deliveryUpdates.at(-1)).toMatchObject({ state: "sent", attempts: 2 });
  });

  it("waits as long as Discord's Retry-After asks", async () => {
    const { core, control, discordCalls, tick } = await setup();
    control.discordStatus = 429;
    control.retryAfter = "600"; // 10 minutes
    await tick();
    control.discordStatus = 204;
    await tick(); // +5 min: still waiting
    expect(discordCalls).toHaveLength(1);
    await tick(); // +10 min: sent
    expect(discordCalls).toHaveLength(2);
    expect(core.queuedAlerts()).toEqual([]);
  });

  it("gives up after 5 attempts", async () => {
    const { core, db, control, tick } = await setup();
    control.discordStatus = 503;
    control.down = true;
    // Retries are 5, 15, 30 and 60 minutes apart; tick well past each.
    for (let i = 0; i < 30; i++) await tick();
    expect(core.queuedAlerts()).toEqual([]);
    const last = db.state.deliveryUpdates.filter((u) => u.id === "inc-1:chan-1:opened").at(-1);
    expect(last).toMatchObject({ state: "failed", attempts: 5 });
  });

  it("disables the channel when Discord says the webhook is gone, and drops its queue", async () => {
    const { core, db, control, tick } = await setup();
    control.discordStatus = 404;
    await tick();
    expect(db.state.disabledChannels).toEqual([{ channelId: "chan-1", reason: "webhook_deleted" }]);
    expect(db.state.deliveryUpdates.at(-1)).toMatchObject({ state: "failed" });
    expect(core.queuedAlerts()).toEqual([]);
  });

  it("never sends a recovery before the outage alert", async () => {
    const { core, control, discordCalls, tick } = await setup();
    control.discordStatus = 502; // the outage alert keeps failing for now
    await tick();
    control.down = false;
    await tick();
    await tick(); // incident resolved; the resolved alert is queued behind the opened one
    expect(core.queuedAlerts().map((a) => a.event)).toEqual(["opened", "resolved"]);
    expect(discordCalls.every((t) => t.includes("down"))).toBe(true);

    control.discordStatus = 204;
    for (let i = 0; i < 12; i++) await tick();
    expect(discordCalls.filter((t) => !t.includes("down"))).toEqual(["🟢 Home is back up"]);
    expect(discordCalls.indexOf("🟢 Home is back up")).toBe(discordCalls.length - 1);
  });

  it("fails the recovery alert too when the outage alert can't be sent", async () => {
    const { core, db, control, tick } = await setup();
    control.discordStatus = 400; // rejected outright, no retry
    await tick();
    control.down = false;
    await tick();
    await tick();
    expect(core.queuedAlerts()).toEqual([]);
    expect(db.state.deliveryUpdates.map((u) => [u.id, u.state])).toContainEqual([
      "inc-1:chan-1:opened",
      "failed",
    ]);
  });

  it("drops queued alerts when the monitor is deleted", async () => {
    const { core, control, tick } = await setup();
    control.discordStatus = 502;
    await tick();
    core.remove(monitor().id);
    expect(core.queuedAlerts()).toEqual([]);
  });
});
