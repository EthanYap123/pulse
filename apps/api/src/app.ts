import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "./db.js";

export type AppOptions = {
  prisma: PrismaClient;
  version: string;
  logger?: boolean;
};

export function buildApp({ prisma, version, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  app.get("/health", async () => {
    let db: "ok" | "error" = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "error";
    }
    return { status: "ok", db, version };
  });

  return app;
}
