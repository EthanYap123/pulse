import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { createCipher } from "../src/crypto.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma, resetDb } from "./helpers/db.js";
import { signUp, type Session } from "./helpers/session.js";

// Shaped like real webhook URLs, but not ones.
const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/example-token-for-tests-only";
const WEBHOOK_2 =
  "https://discord.com/api/webhooks/223456789012345678/another-token-for-tests-only";

const prisma = createTestPrisma();
const discord = { status: 204 };
const alertFetch = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
  Promise.resolve(new Response(null, { status: discord.status })),
);
const app = buildApp({
  prisma,
  config: testConfig,
  alertFetch,
});

let alice: Session;
let projectId: string;

type Channel = {
  id: string;
  name: string;
  state: string;
  target: string;
  disabledReason: string | null;
};

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(prisma);
  alertFetch.mockClear();
  discord.status = 204;
  alice = await signUp(app, "alice@example.com");
  projectId = (
    await alice.request({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "Site", slug: "site" },
    })
  ).json<{ id: string }>().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function addChannel(payload: Record<string, unknown> = {}, as: Session = alice) {
  return as.request({
    method: "POST",
    url: `/v1/projects/${projectId}/channels`,
    payload: { type: "discord", name: "Ops", webhookUrl: WEBHOOK, ...payload },
  });
}

describe("alert channels", () => {
  it("creates a Discord channel, stores the webhook encrypted, and only shows a masked target", async () => {
    const res = await addChannel();
    expect(res.statusCode).toBe(201);
    const channel = res.json<Channel>();
    expect(channel).toMatchObject({
      name: "Ops",
      state: "active",
      cooldownMinutes: 10,
      target: "discord.com/api/webhooks/1234…",
    });
    expect(res.body).not.toContain("example-token");

    const row = await prisma.alertChannel.findUniqueOrThrow({ where: { id: channel.id } });
    expect(row.secretEnc).not.toContain("example-token");
    expect(createCipher(testConfig.encryptionKey).decrypt(row.secretEnc!)).toBe(WEBHOOK);

    const list = await alice.request({ method: "GET", url: `/v1/projects/${projectId}/channels` });
    expect(list.body).not.toContain("example-token");
  });

  it("rejects URLs that aren't Discord webhooks", async () => {
    for (const webhookUrl of ["https://example.com/hook", "http://discord.com/api/webhooks/1/x"]) {
      expect((await addChannel({ webhookUrl })).statusCode).toBe(422);
    }
  });

  it("caps channels at 5 per project", async () => {
    for (let i = 0; i < 5; i++) expect((await addChannel({ name: `c${i}` })).statusCode).toBe(201);
    const sixth = await addChannel();
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toMatchObject({ limit: "channels_per_project", max: 5 });
  });

  it("sends a test message to the webhook", async () => {
    const { id } = (await addChannel()).json<Channel>();
    const res = await alice.request({ method: "POST", url: `/v1/channels/${id}/test` });
    expect(res.statusCode).toBe(200);
    const [url, init] = alertFetch.mock.calls[0]!;
    expect(url).toBe(WEBHOOK);
    const body = JSON.parse(init?.body as string) as { allowed_mentions: unknown };
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  it("disables the channel when Discord says the webhook was deleted, and a new URL re-enables it", async () => {
    const { id } = (await addChannel()).json<Channel>();
    discord.status = 404;
    const res = await alice.request({ method: "POST", url: `/v1/channels/${id}/test` });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: "channel_disabled" });

    const disabled = (
      await alice.request({ method: "GET", url: `/v1/projects/${projectId}/channels` })
    ).json<{ items: Channel[] }>().items[0];
    expect(disabled).toMatchObject({ state: "disabled", disabledReason: "webhook_deleted" });

    const testAgain = await alice.request({ method: "POST", url: `/v1/channels/${id}/test` });
    expect(testAgain.json()).toMatchObject({ code: "channel_inactive" });

    const fixed = await alice.request({
      method: "PATCH",
      url: `/v1/channels/${id}`,
      payload: { webhookUrl: WEBHOOK_2 },
    });
    expect(fixed.json()).toMatchObject({ state: "active", disabledReason: null });
  });

  it("reports a Discord outage without disabling the channel", async () => {
    const { id } = (await addChannel()).json<Channel>();
    discord.status = 503;
    const res = await alice.request({ method: "POST", url: `/v1/channels/${id}/test` });
    expect(res.json()).toMatchObject({ code: "alert_failed" });
    const row = await prisma.alertChannel.findUniqueOrThrow({ where: { id } });
    expect(row.state).toBe("active");
  });

  it("turns a channel off and on, renames it, and deletes it", async () => {
    const { id } = (await addChannel()).json<Channel>();
    const url = `/v1/channels/${id}`;
    const off = await alice.request({ method: "PATCH", url, payload: { enabled: false } });
    expect(off.json()).toMatchObject({ state: "disabled", disabledReason: "turned_off" });
    const on = await alice.request({
      method: "PATCH",
      url,
      payload: { enabled: true, name: "Alerts" },
    });
    expect(on.json()).toMatchObject({ state: "active", name: "Alerts" });
    expect((await alice.request({ method: "DELETE", url })).statusCode).toBe(204);
    expect(await prisma.alertChannel.count()).toBe(0);
  });

  it("hides another user's channels on every route", async () => {
    const { id } = (await addChannel()).json<Channel>();
    const bob = await signUp(app, "bob@example.com");
    const attempts = [
      bob.request({ method: "GET", url: `/v1/projects/${projectId}/channels` }),
      addChannel({}, bob),
      bob.request({ method: "PATCH", url: `/v1/channels/${id}`, payload: { name: "x" } }),
      bob.request({ method: "POST", url: `/v1/channels/${id}/test` }),
      bob.request({ method: "DELETE", url: `/v1/channels/${id}` }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
    expect(alertFetch).not.toHaveBeenCalled();
  });
});

describe("incident detail", () => {
  it("lists the incident's alert deliveries", async () => {
    const { id: channelId } = (await addChannel()).json<Channel>();
    const monitor = (
      await alice.request({
        method: "POST",
        url: `/v1/projects/${projectId}/monitors`,
        payload: { name: "Home", url: "https://example.com" },
      })
    ).json<{ id: string }>();
    const incident = await prisma.incident.create({
      data: { monitorId: monitor.id, startedAt: new Date(), cause: "timeout" },
    });
    await prisma.alertDelivery.create({
      data: {
        incidentId: incident.id,
        channelId,
        event: "opened",
        state: "sent",
        attempts: 1,
        sentAt: new Date(),
      },
    });
    const res = await alice.request({ method: "GET", url: `/v1/incidents/${incident.id}` });
    expect(res.json()).toMatchObject({
      deliveries: [{ channelName: "Ops", event: "opened", state: "sent", attempts: 1 }],
    });
  });
});
