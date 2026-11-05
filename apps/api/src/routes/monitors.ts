import {
  LIMITS,
  monitorInputSchema,
  monitorPatchSchema,
  uptimePct,
  type CheckerMonitor,
  type LiveStatus,
} from "@pulse/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CheckerClient } from "../checker-client.js";
import { AppError, notFound } from "../errors.js";
import type { Repositories } from "../repositories/index.js";
import type { CapExceeded } from "../repositories/monitors.js";
import { idParam } from "./params.js";

type MonitorRow = NonNullable<Awaited<ReturnType<Repositories["monitors"]["get"]>>>;

/**
 * The API shape from docs/API.md. Header values are write-only: only their names come back.
 * Status comes from the checker when it answers, otherwise from the last hourly flush.
 */
function toMonitor(m: MonitorRow, live: LiveStatus | undefined) {
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
    status: m.isPaused ? "paused" : (live?.status ?? m.lastStatus),
    lastCheckedAt: live?.lastCheckedAt ?? m.lastCheckedAt?.toISOString() ?? null,
    lastLatencyMs: live?.lastLatencyMs ?? null,
    openIncidentId: m.incidents[0]?.id ?? null,
    statusSource: live ? "live" : "last_flush",
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function toCheckerMonitor(m: MonitorRow): CheckerMonitor {
  return {
    id: m.id,
    shard: m.shard,
    url: m.url,
    method: m.method,
    expectedStatus: { min: m.expectedStatusMin, max: m.expectedStatusMax },
    timeoutMs: m.timeoutMs,
    failureThreshold: m.failureThreshold,
    encryptedHeaders: m.headers as Record<string, string>,
    isPaused: m.isPaused,
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

const historyQuerySchema = z.object({ range: z.enum(["24h", "7d", "30d"]).default("24h") });
const uptimeQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(90).default(90) });

/** Registered inside the authenticated scope in app.ts. */
export function monitorRoutes(
  app: FastifyInstance,
  repos: Repositories,
  checker: CheckerClient | null,
): void {
  async function withLive(rows: MonitorRow[]) {
    const live = checker
      ? await checker.live(rows.map((m) => ({ id: m.id, shard: m.shard })))
      : null;
    return rows.map((m) => toMonitor(m, live?.get(m.id)));
  }

  async function current(userId: string, id: string) {
    const monitor = await repos.monitors.get(userId, id);
    if (!monitor) throw notFound();
    return (await withLive([monitor]))[0]!;
  }

  /** Pushes the stored config to the checker after a change. */
  async function sync(userId: string, id: string): Promise<void> {
    const monitor = await repos.monitors.get(userId, id);
    if (monitor && checker) {
      await checker.sync(toCheckerMonitor(monitor));
      await checker.refreshStatusPages([monitor.projectId]);
    }
  }

  app.get("/v1/projects/:projectId/monitors", async (request) => {
    const monitors = await repos.monitors.listByProject(
      request.userId,
      idParam(request.params, "projectId"),
    );
    if (!monitors) throw notFound();
    return { items: await withLive(monitors) };
  });

  app.post("/v1/projects/:projectId/monitors", async (request, reply) => {
    const projectId = idParam(request.params, "projectId");
    const input = monitorInputSchema.parse(request.body);
    const result = await repos.monitors.create(request.userId, projectId, input);
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "limit_reached") throw capError(result);
    await sync(request.userId, result.id);
    return reply.code(201).send(await current(request.userId, result.id));
  });

  app.get("/v1/monitors/:monitorId", (request) =>
    current(request.userId, idParam(request.params, "monitorId")),
  );

  app.get("/v1/monitors/:monitorId/checks", async (request) => {
    const { range } = historyQuerySchema.parse(request.query);
    const points = await repos.monitors.history(
      request.userId,
      idParam(request.params, "monitorId"),
      range,
    );
    if (!points) throw notFound();
    const checks = points.reduce((n, p) => n + (p.checks ?? 1), 0);
    const failures = points.reduce((n, p) => n + (p.failures ?? (p.ok ? 0 : 1)), 0);
    return {
      range,
      points,
      uptimePct: uptimePct(checks, failures),
    };
  });

  app.get("/v1/monitors/:monitorId/uptime", async (request) => {
    const { days } = uptimeQuerySchema.parse(request.query);
    const rows = await repos.monitors.dailyUptime(
      request.userId,
      idParam(request.params, "monitorId"),
      days,
    );
    if (!rows) throw notFound();
    const checks = rows.reduce((n, r) => n + r.checks, 0);
    const failures = rows.reduce((n, r) => n + r.failures, 0);
    return {
      days: rows.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        uptimePct: uptimePct(r.checks, r.failures),
        checks: r.checks,
      })),
      uptimePct: uptimePct(checks, failures),
    };
  });

  app.patch("/v1/monitors/:monitorId", async (request) => {
    const id = idParam(request.params, "monitorId");
    const patch = monitorPatchSchema.parse(request.body);
    const result = await repos.monitors.update(request.userId, id, patch);
    if (result.kind === "not_found") throw notFound();
    await sync(request.userId, id);
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
      await sync(request.userId, id);
      return current(request.userId, id);
    });
  }

  app.delete("/v1/monitors/:monitorId", async (request, reply) => {
    const id = idParam(request.params, "monitorId");
    const deleted = await repos.monitors.delete(request.userId, id);
    if (!deleted) throw notFound();
    await checker?.remove(id, deleted.shard);
    await checker?.refreshStatusPages([deleted.projectId]);
    return reply.code(204).send();
  });
}
