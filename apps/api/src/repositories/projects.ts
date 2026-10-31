import { LIMITS, type ProjectInput, type ProjectPatch } from "@pulse/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { isUniqueViolation } from "./errors.js";
import { lockUser } from "./locks.js";

const withMonitorCount = { _count: { select: { monitors: true } } } as const;

export type CreateProjectResult =
  { kind: "created"; id: string } | { kind: "limit_reached" } | { kind: "slug_taken" };

export type UpdateProjectResult =
  { kind: "updated" } | { kind: "not_found" } | { kind: "slug_taken" };

/** Every query is scoped to the owner (docs/adr/0003-multi-tenancy.md). */
export function projectsRepository(prisma: PrismaClient) {
  return {
    list(ownerId: string) {
      return prisma.project.findMany({
        where: { ownerId },
        include: withMonitorCount,
        orderBy: { createdAt: "asc" },
      });
    },

    get(ownerId: string, id: string) {
      return prisma.project.findFirst({ where: { id, ownerId }, include: withMonitorCount });
    },

    async create(ownerId: string, input: ProjectInput): Promise<CreateProjectResult> {
      try {
        return await prisma.$transaction(async (tx) => {
          await lockUser(tx, ownerId);
          const count = await tx.project.count({ where: { ownerId } });
          if (count >= LIMITS.projectsPerUser) return { kind: "limit_reached" } as const;
          const project = await tx.project.create({ data: { ownerId, ...input } });
          return { kind: "created", id: project.id } as const;
        });
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "slug_taken" };
        throw error;
      }
    },

    async update(ownerId: string, id: string, patch: ProjectPatch): Promise<UpdateProjectResult> {
      try {
        const { count } = await prisma.project.updateMany({ where: { id, ownerId }, data: patch });
        return count === 0 ? { kind: "not_found" } : { kind: "updated" };
      } catch (error) {
        if (isUniqueViolation(error)) return { kind: "slug_taken" };
        throw error;
      }
    },

    /** Returns false if there was nothing of this owner's to delete. */
    async delete(ownerId: string, id: string): Promise<boolean> {
      const { count } = await prisma.project.deleteMany({ where: { id, ownerId } });
      return count > 0;
    },
  };
}
