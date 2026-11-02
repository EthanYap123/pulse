import {
  LIMITS,
  channelInputSchema,
  channelPatchSchema,
  classifyDiscordResponse,
  discordPayload,
  maskWebhook,
} from "@pulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError, notFound } from "../errors.js";
import type { ChannelRow } from "../repositories/channels.js";
import type { Repositories } from "../repositories/index.js";
import { idParam } from "./params.js";

/** The Channel shape from docs/API.md. The webhook URL itself is never returned. */
function toChannel(c: ChannelRow, webhookUrl: string | null) {
  return {
    id: c.id,
    projectId: c.projectId,
    type: c.type,
    name: c.name,
    cooldownMinutes: c.cooldownMinutes,
    state: c.state,
    disabledReason: c.disabledReason,
    target: webhookUrl ? maskWebhook(webhookUrl) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Registered inside the authenticated scope in app.ts. */
export function channelRoutes(
  app: FastifyInstance,
  repos: Repositories,
  fetchImpl: typeof fetch,
): void {
  const present = (c: ChannelRow) => toChannel(c, repos.channels.decryptSecret(c));

  async function current(userId: string, id: string) {
    const channel = await repos.channels.get(userId, id);
    if (!channel) throw notFound();
    return channel;
  }

  app.get("/v1/projects/:projectId/channels", async (request) => {
    const channels = await repos.channels.listByProject(
      request.userId,
      idParam(request.params, "projectId"),
    );
    if (!channels) throw notFound();
    return { items: channels.map(present) };
  });

  app.post("/v1/projects/:projectId/channels", async (request, reply) => {
    const input = channelInputSchema.parse(request.body);
    const result = await repos.channels.create(
      request.userId,
      idParam(request.params, "projectId"),
      input,
    );
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "limit_reached") {
      throw new AppError(
        409,
        "limit_reached",
        `A project can have up to ${LIMITS.channelsPerProject} alert channels`,
        { limit: "channels_per_project", max: LIMITS.channelsPerProject },
      );
    }
    return reply.code(201).send(present(await current(request.userId, result.id)));
  });

  app.patch("/v1/channels/:channelId", async (request) => {
    const id = idParam(request.params, "channelId");
    const patch = channelPatchSchema.parse(request.body);
    if (!(await repos.channels.update(request.userId, id, patch))) throw notFound();
    return present(await current(request.userId, id));
  });

  app.delete("/v1/channels/:channelId", async (request, reply) => {
    const deleted = await repos.channels.delete(
      request.userId,
      idParam(request.params, "channelId"),
    );
    if (!deleted) throw notFound();
    return reply.code(204).send();
  });

  /** Sends a test message straight away, so the owner knows alerts will arrive. */
  app.post("/v1/channels/:channelId/test", async (request) => {
    const channel = await current(request.userId, idParam(request.params, "channelId"));
    const webhookUrl = repos.channels.decryptSecret(channel);
    if (channel.state !== "active" || !webhookUrl) {
      throw new AppError(409, "channel_inactive", "Turn the channel on before testing it");
    }
    const body = discordPayload({
      event: "test",
      projectName: channel.project.name,
      monitorName: "Test",
      monitorUrl: "https://github.com/EthanYap123/pulse",
    });
    let outcome;
    try {
      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      outcome = classifyDiscordResponse(res.status, res.headers.get("retry-after"));
    } catch {
      throw new AppError(502, "alert_failed", "Couldn't reach Discord. Try again in a moment.");
    }
    if (outcome.kind === "sent") return { sent: true };
    if (outcome.kind === "disable") {
      await repos.channels.disable(channel.id, outcome.reason);
      throw new AppError(
        502,
        "channel_disabled",
        "Discord says this webhook no longer exists. Paste a new webhook URL to turn the channel back on.",
      );
    }
    throw new AppError(502, "alert_failed", `Discord didn't accept the message: ${outcome.error}`);
  });
}
