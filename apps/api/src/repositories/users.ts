import type { PrismaClient } from "../generated/prisma/client.js";
import { isUniqueViolation } from "./errors.js";

export type UserRecord = { id: string; email: string; createdAt: Date };

const publicFields = { id: true, email: true, createdAt: true } as const;

export function usersRepository(prisma: PrismaClient) {
  return {
    /** Returns null when the email is already registered. */
    async create(email: string, passwordHash: string): Promise<UserRecord | null> {
      try {
        return await prisma.user.create({ data: { email, passwordHash }, select: publicFields });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    findByEmail(email: string) {
      return prisma.user.findUnique({ where: { email } });
    },

    findById(id: string): Promise<UserRecord | null> {
      return prisma.user.findUnique({ where: { id }, select: publicFields });
    },

    async usage(userId: string): Promise<{ projects: number; monitors: number }> {
      const [projects, monitors] = await Promise.all([
        prisma.project.count({ where: { ownerId: userId } }),
        prisma.monitor.count({ where: { project: { ownerId: userId } } }),
      ]);
      return { projects, monitors };
    },
  };
}
