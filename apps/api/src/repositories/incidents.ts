import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

const withMonitorName = { monitor: { select: { name: true } } } as const;

export type IncidentRow = Prisma.IncidentGetPayload<{ include: typeof withMonitorName }>;

export type IncidentFilter = { status?: "open" | "resolved"; limit: number; cursor?: string };

/** Every query is scoped to the owner through monitor -> project (ADR-0003). */
export function incidentsRepository(prisma: PrismaClient) {
  const owned = (ownerId: string) => ({ monitor: { project: { ownerId } } });

  return {
    /** Newest first. Null when the project doesn't exist or isn't the owner's. */
    async listByProject(ownerId: string, projectId: string, filter: IncidentFilter) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId },
        select: { id: true },
      });
      if (!project) return null;
      const rows = await prisma.incident.findMany({
        where: {
          monitor: { projectId },
          ...(filter.status === "open" ? { resolvedAt: null } : {}),
          ...(filter.status === "resolved" ? { resolvedAt: { not: null } } : {}),
        },
        include: withMonitorName,
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: filter.limit + 1,
        ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      });
      const hasMore = rows.length > filter.limit;
      const items = hasMore ? rows.slice(0, filter.limit) : rows;
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    },

    get(ownerId: string, id: string): Promise<IncidentRow | null> {
      return prisma.incident.findFirst({
        where: { id, ...owned(ownerId) },
        include: withMonitorName,
      });
    },

    async setNote(ownerId: string, id: string, note: string | null): Promise<boolean> {
      const { count } = await prisma.incident.updateMany({
        where: { id, ...owned(ownerId) },
        data: { note },
      });
      return count > 0;
    },
  };
}
