import { randomUUID } from "node:crypto";
import { LIMITS, shardFor, type MonitorInput, type MonitorPatch } from "@pulse/shared";
import type { Cipher } from "../crypto.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { lockActiveMonitorCount, lockUser } from "./locks.js";

export type CapExceeded = { kind: "limit_reached"; limit: "monitors_per_user" | "active_monitors" };

export type CreateMonitorResult =
  { kind: "created"; id: string } | { kind: "not_found" } | CapExceeded;
export type ChangeMonitorResult = { kind: "updated" } | { kind: "not_found" } | CapExceeded;

const owned = (ownerId: string, id: string) => ({ id, project: { ownerId } });

/** Every query is scoped to the owner through the project (docs/adr/0003-multi-tenancy.md). */
export function monitorsRepository(prisma: PrismaClient, cipher: Cipher) {
  function encryptHeaders(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, cipher.encrypt(value)]),
    );
  }

  function toColumns(input: MonitorPatch): Prisma.MonitorUpdateManyMutationInput {
    return {
      name: input.name,
      url: input.url,
      method: input.method,
      expectedStatusMin: input.expectedStatus?.min,
      expectedStatusMax: input.expectedStatus?.max,
      timeoutMs: input.timeoutMs,
      failureThreshold: input.failureThreshold,
      headers: input.headers && encryptHeaders(input.headers),
      showOnStatusPage: input.showOnStatusPage,
    };
  }

  async function activeMonitorsFull(tx: Prisma.TransactionClient): Promise<boolean> {
    await lockActiveMonitorCount(tx);
    const active = await tx.monitor.count({ where: { isPaused: false } });
    return active >= LIMITS.activeMonitorsGlobal;
  }

  return {
    /** Null when the project doesn't exist or isn't the owner's. */
    async listByProject(ownerId: string, projectId: string) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId },
        select: { monitors: { orderBy: { createdAt: "asc" } } },
      });
      return project?.monitors ?? null;
    },

    get(ownerId: string, id: string) {
      return prisma.monitor.findFirst({ where: owned(ownerId, id) });
    },

    create(ownerId: string, projectId: string, input: MonitorInput): Promise<CreateMonitorResult> {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, ownerId);
        const project = await tx.project.findFirst({ where: { id: projectId, ownerId } });
        if (!project) return { kind: "not_found" } as const;

        const mine = await tx.monitor.count({ where: { project: { ownerId } } });
        if (mine >= LIMITS.monitorsPerUser) {
          return { kind: "limit_reached", limit: "monitors_per_user" } as const;
        }
        if (await activeMonitorsFull(tx)) {
          return { kind: "limit_reached", limit: "active_monitors" } as const;
        }

        const id = randomUUID();
        await tx.monitor.create({
          data: {
            ...(toColumns(input) as Prisma.MonitorUncheckedCreateInput),
            id,
            projectId,
            shard: shardFor(id),
          },
        });
        return { kind: "created", id } as const;
      });
    },

    async update(ownerId: string, id: string, patch: MonitorPatch): Promise<ChangeMonitorResult> {
      const { count } = await prisma.monitor.updateMany({
        where: owned(ownerId, id),
        data: toColumns(patch),
      });
      return count === 0 ? { kind: "not_found" } : { kind: "updated" };
    },

    setPaused(ownerId: string, id: string, paused: boolean): Promise<ChangeMonitorResult> {
      return prisma.$transaction(async (tx) => {
        const monitor = await tx.monitor.findFirst({ where: owned(ownerId, id) });
        if (!monitor) return { kind: "not_found" } as const;
        // Resuming adds an active monitor, so it counts against the global cap.
        if (!paused && monitor.isPaused && (await activeMonitorsFull(tx))) {
          return { kind: "limit_reached", limit: "active_monitors" } as const;
        }
        await tx.monitor.update({ where: { id }, data: { isPaused: paused } });
        return { kind: "updated" } as const;
      });
    },

    /** Returns the deleted monitor's shard (so the checker can drop it), or null if not found. */
    async delete(ownerId: string, id: string): Promise<{ shard: number } | null> {
      const monitor = await prisma.monitor.findFirst({
        where: owned(ownerId, id),
        select: { shard: true },
      });
      if (!monitor) return null;
      const { count } = await prisma.monitor.deleteMany({ where: owned(ownerId, id) });
      return count > 0 ? monitor : null;
    },

    /**
     * Latency history for the chart. 24h returns every check; 7d and 30d return hourly
     * buckets. Until the Phase 3 rollups exist, buckets come from raw checks (kept 7 days).
     */
    async history(
      ownerId: string,
      id: string,
      range: HistoryRange,
    ): Promise<HistoryPoint[] | null> {
      const monitor = await prisma.monitor.findFirst({
        where: owned(ownerId, id),
        select: { id: true },
      });
      if (!monitor) return null;
      if (range === "24h") {
        const rows = await prisma.$queryRaw<RawPoint[]>`
          SELECT checked_at AS t, ok, latency_ms
          FROM check_results
          WHERE monitor_id = ${id}::uuid AND checked_at > now() - interval '24 hours'
          ORDER BY checked_at`;
        return rows.map((r) => ({ t: r.t.toISOString(), ok: r.ok, latencyMs: r.latency_ms }));
      }
      const days = range === "7d" ? 7 : 30;
      const rows = await prisma.$queryRaw<HourlyPoint[]>`
        SELECT date_trunc('hour', checked_at) AS t,
               count(*)::int AS checks,
               (count(*) FILTER (WHERE NOT ok))::int AS failures,
               round(avg(latency_ms) FILTER (WHERE ok))::int AS avg_ms,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok))::int AS p95_ms
        FROM check_results
        WHERE monitor_id = ${id}::uuid AND checked_at > now() - make_interval(days => ${days}::int)
        GROUP BY 1
        ORDER BY 1`;
      return rows.map((r) => ({
        t: r.t.toISOString(),
        ok: r.failures === 0,
        latencyMs: r.avg_ms,
        avgMs: r.avg_ms,
        p95Ms: r.p95_ms,
        checks: r.checks,
        failures: r.failures,
      }));
    },
  };
}

export type HistoryRange = "24h" | "7d" | "30d";

/** One check (24h) or one hourly bucket (7d, 30d), which also has the aggregate fields. */
export type HistoryPoint = {
  t: string;
  ok: boolean;
  latencyMs: number | null;
  avgMs?: number | null;
  p95Ms?: number | null;
  checks?: number;
  failures?: number;
};
type RawPoint = { t: Date; ok: boolean; latency_ms: number | null };
type HourlyPoint = {
  t: Date;
  checks: number;
  failures: number;
  avg_ms: number | null;
  p95_ms: number | null;
};
