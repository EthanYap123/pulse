import { z } from "zod";
import type { CheckError } from "./check.js";

// Channels --------------------------------------------------------------------

/** Discord channel webhooks only: https://discord.com/api/webhooks/<id>/<token>. */
export const discordWebhookSchema = z
  .string()
  .trim()
  .regex(
    /^https:\/\/(?:(?:ptb|canary)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d{15,22}\/[\w-]{20,120}$/,
    { message: "Paste a Discord webhook URL (https://discord.com/api/webhooks/...)" },
  );

const channelName = z.string().trim().min(1).max(60);
const cooldownMinutes = z.number().int().min(0).max(1440);

export const channelInputSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("discord"),
    name: channelName,
    webhookUrl: discordWebhookSchema,
    cooldownMinutes: cooldownMinutes.default(10),
  }),
]);
export type ChannelInput = z.infer<typeof channelInputSchema>;

export const channelPatchSchema = z.strictObject({
  name: channelName.optional(),
  webhookUrl: discordWebhookSchema.optional(),
  cooldownMinutes: cooldownMinutes.optional(),
  /** Re-enables a disabled channel (e.g. after fixing a deleted webhook) or turns one off. */
  enabled: z.boolean().optional(),
});
export type ChannelPatch = z.infer<typeof channelPatchSchema>;

/** "discord.com/api/webhooks/1234…": enough to recognise, not enough to use. */
export function maskWebhook(url: string): string {
  const match = /^https:\/\/([^/]+)\/api\/webhooks\/(\d+)\//.exec(url);
  return match ? `${match[1]}/api/webhooks/${match[2]!.slice(0, 4)}…` : "Discord webhook";
}

// Messages --------------------------------------------------------------------

export type AlertMessage = {
  event: "opened" | "resolved" | "test";
  projectName: string;
  monitorName: string;
  monitorUrl: string;
  startedAt?: string;
  resolvedAt?: string;
  cause?: CheckError;
  lastStatusCode?: number | null;
  /** Why a resolved incident ended. */
  reason?: "recovered" | "paused";
};

const CAUSE_TEXT: Record<CheckError, string> = {
  status: "Unexpected status code",
  timeout: "Timed out",
  dns: "DNS lookup failed",
  tls: "TLS/certificate error",
  connection: "Couldn't connect",
};

const COLOR = { opened: 0xb91c1c, resolved: 0x15803d, test: 0x0f766e };

export function formatDuration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The JSON body for a Discord webhook. Mentions are disabled, so names can't ping anyone. */
export function discordPayload(message: AlertMessage): Record<string, unknown> {
  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "URL", value: truncate(message.monitorUrl, 1024) },
  ];
  let title: string;
  let description: string;

  if (message.event === "opened") {
    title = `🔴 ${message.monitorName} is down`;
    const status = message.lastStatusCode ? ` (HTTP ${message.lastStatusCode})` : "";
    description = `${CAUSE_TEXT[message.cause ?? "connection"]}${status}.`;
  } else if (message.event === "resolved") {
    const paused = message.reason === "paused";
    title = paused
      ? `⏸️ ${message.monitorName}: incident closed`
      : `🟢 ${message.monitorName} is back up`;
    description = paused ? "The monitor was paused." : "Two checks in a row passed.";
    if (message.startedAt && message.resolvedAt) {
      fields.push({
        name: "Down for",
        value: formatDuration(message.startedAt, message.resolvedAt),
        inline: true,
      });
    }
  } else {
    title = "✅ Pulse test message";
    description = `Alerts for **${message.projectName}** will arrive in this channel.`;
  }

  return {
    username: "Pulse",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: truncate(title, 256),
        description,
        color: COLOR[message.event],
        fields,
        footer: { text: truncate(message.projectName, 2048) },
        timestamp: message.resolvedAt ?? message.startedAt ?? new Date().toISOString(),
      },
    ],
  };
}

// Delivery outcomes -----------------------------------------------------------

export type SendOutcome =
  | { kind: "sent" }
  | { kind: "retry"; afterMs: number | null; error: string }
  | { kind: "disable"; reason: string; error: string }
  | { kind: "failed"; error: string };

/**
 * What to do after Discord answers a webhook call. 404 means the webhook was deleted
 * (Discord asks callers to stop using it); 401/403 means its token is no longer valid.
 */
export function classifyDiscordResponse(status: number, retryAfter: string | null): SendOutcome {
  if (status >= 200 && status < 300) return { kind: "sent" };
  if (status === 429) {
    const seconds = Number(retryAfter);
    return {
      kind: "retry",
      afterMs: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null,
      error: "rate limited (429)",
    };
  }
  if (status === 404) {
    return { kind: "disable", reason: "webhook_deleted", error: "webhook not found (404)" };
  }
  if (status === 401 || status === 403) {
    return { kind: "disable", reason: "webhook_unauthorized", error: `rejected (${status})` };
  }
  if (status >= 500) return { kind: "retry", afterMs: null, error: `Discord error (${status})` };
  return { kind: "failed", error: `rejected (${status})` };
}

/** Delays before attempts 2..5 after a retryable failure; after the 5th attempt it fails. */
export const RETRY_DELAYS_MS = [5, 15, 30, 60].map((m) => m * 60_000);
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
