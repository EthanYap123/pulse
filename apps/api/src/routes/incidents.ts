import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { notFound } from "../errors.js";
import type { IncidentRow } from "../repositories/incidents.js";
import type { Repositories } from "../repositories/index.js";
import { idParam } from "./params.js";

/** The Incident shape from docs/API.md. */
function toIncident(i: IncidentRow) {
  return {
    id: i.id,
    monitorId: i.monitorId,
    monitorName: i.monitor.name,
    startedAt: i.startedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    durationSec: i.resolvedAt
      ? Math.round((i.resolvedAt.getTime() - i.startedAt.getTime()) / 1000)
      : null,
    cause: i.cause,
    lastStatusCode: i.lastStatusCode,
    resolveReason: i.resolveReason,
    note: i.note,
  };
}

const listQuerySchema = z.object({
  status: z.enum(["open", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

const noteSchema = z.strictObject({
  note: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((note) => note || null),
});

/** Registered inside the authenticated scope in app.ts. */
export function incidentRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get("/v1/projects/:projectId/incidents", async (request) => {
    const filter = listQuerySchema.parse(request.query);
    const page = await repos.incidents.listByProject(
      request.userId,
      idParam(request.params, "projectId"),
      filter,
    );
    if (!page) throw notFound();
    return { items: page.items.map(toIncident), nextCursor: page.nextCursor };
  });

  app.get("/v1/incidents/:incidentId", async (request) => {
    const incident = await repos.incidents.get(
      request.userId,
      idParam(request.params, "incidentId"),
    );
    if (!incident) throw notFound();
    const deliveries = await repos.incidents.deliveries(incident.id);
    return {
      ...toIncident(incident),
      deliveries: deliveries.map((d) => ({
        channelId: d.channelId,
        channelName: d.channel.name,
        event: d.event,
        state: d.state,
        attempts: d.attempts,
        sentAt: d.sentAt?.toISOString() ?? null,
        lastError: d.lastError,
      })),
    };
  });

  app.patch("/v1/incidents/:incidentId", async (request) => {
    const id = idParam(request.params, "incidentId");
    const { note } = noteSchema.parse(request.body);
    if (!(await repos.incidents.setNote(request.userId, id, note))) throw notFound();
    return toIncident((await repos.incidents.get(request.userId, id))!);
  });
}
