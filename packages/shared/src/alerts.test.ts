import { describe, expect, it } from "vitest";
import {
  channelInputSchema,
  classifyDiscordResponse,
  discordPayload,
  discordWebhookSchema,
  formatDuration,
  maskWebhook,
} from "./alerts.js";

// Shaped like a real webhook URL, but not one.
const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/example-token-for-tests-only";

describe("discordWebhookSchema", () => {
  it.each([
    WEBHOOK,
    "https://discordapp.com/api/webhooks/123456789012345678/example-token-for-tests-only",
    "https://canary.discord.com/api/webhooks/123456789012345678/example-token-for-tests-only",
  ])("accepts %s", (url) => {
    expect(discordWebhookSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    "http://discord.com/api/webhooks/123456789012345678/example-token-for-tests-only",
    "https://evil.com/api/webhooks/123456789012345678/example-token-for-tests-only",
    "https://discord.com.evil.com/api/webhooks/123456789012345678/example-token-for-tests-only",
    "https://discord.com/api/webhooks/123/short",
    "https://discord.com/channels/123",
  ])("rejects %s", (url) => {
    expect(discordWebhookSchema.safeParse(url).success).toBe(false);
  });
});

describe("channelInputSchema", () => {
  it("defaults the cooldown to 10 minutes", () => {
    expect(channelInputSchema.parse({ type: "discord", name: "Ops", webhookUrl: WEBHOOK })).toEqual(
      {
        type: "discord",
        name: "Ops",
        webhookUrl: WEBHOOK,
        cooldownMinutes: 10,
      },
    );
  });

  it("doesn't accept Telegram yet", () => {
    expect(channelInputSchema.safeParse({ type: "telegram", name: "x" }).success).toBe(false);
  });
});

describe("maskWebhook", () => {
  it("keeps the host and the start of the id, never the token", () => {
    expect(maskWebhook(WEBHOOK)).toBe("discord.com/api/webhooks/1234…");
    expect(maskWebhook(WEBHOOK)).not.toContain("token");
  });
});

describe("discordPayload", () => {
  const base = { projectName: "Site", monitorName: "API", monitorUrl: "https://example.com/" };

  it("describes an outage with cause and status, and never pings anyone", () => {
    const body = discordPayload({
      ...base,
      event: "opened",
      startedAt: "2026-11-01T12:00:00Z",
      cause: "status",
      lastStatusCode: 503,
    });
    expect(body.allowed_mentions).toEqual({ parse: [] });
    const [embed] = body.embeds as { title: string; description: string }[];
    expect(embed?.title).toBe("🔴 API is down");
    expect(embed?.description).toBe("Unexpected status code (HTTP 503).");
  });

  it("says how long a recovered outage lasted", () => {
    const body = discordPayload({
      ...base,
      event: "resolved",
      reason: "recovered",
      startedAt: "2026-11-01T12:00:00Z",
      resolvedAt: "2026-11-01T13:25:00Z",
    });
    const [embed] = body.embeds as { title: string; fields: { name: string; value: string }[] }[];
    expect(embed?.title).toBe("🟢 API is back up");
    expect(embed?.fields).toContainEqual({ name: "Down for", value: "1 h 25 min", inline: true });
  });

  it("explains an incident closed by pausing", () => {
    const body = discordPayload({ ...base, event: "resolved", reason: "paused" });
    const [embed] = body.embeds as { description: string }[];
    expect(embed?.description).toBe("The monitor was paused.");
  });

  it("truncates very long names to Discord's title limit", () => {
    const body = discordPayload({ ...base, monitorName: "x".repeat(400), event: "opened" });
    const [embed] = body.embeds as { title: string }[];
    expect(embed?.title.length).toBe(256);
  });

  it("builds a test message", () => {
    const [embed] = discordPayload({ ...base, event: "test" }).embeds as { title: string }[];
    expect(embed?.title).toContain("test");
  });
});

describe("formatDuration", () => {
  it("rounds to minutes", () => {
    expect(formatDuration("2026-11-01T12:00:00Z", "2026-11-01T12:07:20Z")).toBe("7 min");
    expect(formatDuration("2026-11-01T12:00:00Z", "2026-11-01T14:00:00Z")).toBe("2 h");
  });
});

describe("classifyDiscordResponse", () => {
  it.each([
    [204, null, { kind: "sent" }],
    [200, null, { kind: "sent" }],
    [429, "2.5", { kind: "retry", afterMs: 2500 }],
    [429, null, { kind: "retry", afterMs: null }],
    [404, null, { kind: "disable", reason: "webhook_deleted" }],
    [401, null, { kind: "disable", reason: "webhook_unauthorized" }],
    [403, null, { kind: "disable", reason: "webhook_unauthorized" }],
    [502, null, { kind: "retry", afterMs: null }],
    [400, null, { kind: "failed" }],
  ])("%i (retry-after %s)", (status, retryAfter, expected) => {
    expect(classifyDiscordResponse(status, retryAfter)).toMatchObject(expected);
  });
});
