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

    async delete(ownerId: string, id: string): Promise<boolean> {
      const { count } = await prisma.monitor.deleteMany({ where: owned(ownerId, id) });
      return count > 0;
    },
  };
}
