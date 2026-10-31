import type { Cipher } from "../crypto.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { monitorsRepository } from "./monitors.js";
import { projectsRepository } from "./projects.js";
import { refreshTokensRepository } from "./refresh-tokens.js";
import { usersRepository } from "./users.js";

/** The only place route code gets data access from (see docs/adr/0003-multi-tenancy.md). */
export function createRepositories(prisma: PrismaClient, cipher: Cipher) {
  return {
    users: usersRepository(prisma),
    refreshTokens: refreshTokensRepository(prisma),
    projects: projectsRepository(prisma),
    monitors: monitorsRepository(prisma, cipher),
    health: {
      async ping(): Promise<void> {
        await prisma.$queryRaw`SELECT 1`;
      },
    },
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
