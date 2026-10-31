import { LIMITS, monitorInputSchema, monitorPatchSchema } from "@pulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError, notFound } from "../errors.js";
import type { Repositories } from "../repositories/index.js";
import type { CapExceeded } from "../repositories/monitors.js";
import { idParam } from "./params.js";

type MonitorRow = NonNullable<Awaited<ReturnType<Repositories["monitors"]["get"]>>>;

/**
 * The API shape from docs/API.md. Header values are write-only: only their names come back.
 * Live status from the checker replaces `status` and `statusSource` once the checker exists.
 */
function toMonitor(m: MonitorRow) {
  return {
    id: m.id,
    projectId: m.projectId,
    name: m.name,
    url: m.url,
    method: m.method,
    expectedStatus: { min: m.expectedStatusMin, max: m.expectedStatusMax },
    timeoutMs: m.timeoutMs,
    failureThreshold: m.failureThreshold,
    headerNames: Object.keys(m.headers as Record<string, string>),
    showOnStatusPage: m.showOnStatusPage,
    isPaused: m.isPaused,
    status: m.isPaused ? "paused" : m.lastStatus,
    lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null,
    lastLatencyMs: null,
    openIncidentId: null,
    statusSource: "last_flush",
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function capError(result: CapExceeded): AppError {
  if (result.limit === "monitors_per_user") {
    return new AppError(
      409,
      "limit_reached",
      `You can have up to ${LIMITS.monitorsPerUser} monitors`,
      {
        limit: "monitors_per_user",
        max: LIMITS.monitorsPerUser,
      },
    );
  }
  return new AppError(
    409,
    "limit_reached",
    "Pulse is checking as many monitors as its free hosting allows. Try again later.",
    { limit: "active_monitors", max: LIMITS.activeMonitorsGlobal },
  );
}

/** Registered inside the authenticated scope in app.ts. */
export function monitorRoutes(app: FastifyInstance, repos: Repositories): void {
  async function current(userId: string, id: string) {
    const monitor = await repos.monitors.get(userId, id);
    if (!monitor) throw notFound();
    return toMonitor(monitor);
  }

  app.get("/v1/projects/:projectId/monitors", async (request) => {
    const monitors = await repos.monitors.listByProject(
      request.userId,
      idParam(request.params, "projectId"),
    );
    if (!monitors) throw notFound();
    return { items: monitors.map(toMonitor) };
  });

  app.post("/v1/projects/:projectId/monitors", async (request, reply) => {
    const projectId = idParam(request.params, "projectId");
    const input = monitorInputSchema.parse(request.body);
    const result = await repos.monitors.create(request.userId, projectId, input);
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "limit_reached") throw capError(result);
    return reply.code(201).send(await current(request.userId, result.id));
  });

  app.get("/v1/monitors/:monitorId", (request) =>
    current(request.userId, idParam(request.params, "monitorId")),
  );

  app.patch("/v1/monitors/:monitorId", async (request) => {
    const id = idParam(request.params, "monitorId");
    const patch = monitorPatchSchema.parse(request.body);
    const result = await repos.monitors.update(request.userId, id, patch);
    if (result.kind === "not_found") throw notFound();
    return current(request.userId, id);
  });

  for (const [action, paused] of [
    ["pause", true],
    ["resume", false],
  ] as const) {
    app.post(`/v1/monitors/:monitorId/${action}`, async (request) => {
      const id = idParam(request.params, "monitorId");
      const result = await repos.monitors.setPaused(request.userId, id, paused);
      if (result.kind === "not_found") throw notFound();
      if (result.kind === "limit_reached") throw capError(result);
      return current(request.userId, id);
    });
  }

  app.delete("/v1/monitors/:monitorId", async (request, reply) => {
    const deleted = await repos.monitors.delete(
      request.userId,
      idParam(request.params, "monitorId"),
    );
    if (!deleted) throw notFound();
    return reply.code(204).send();
  });
}
