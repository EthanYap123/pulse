import Fastify, { type FastifyInstance } from "fastify";
import type { PrismaClient } from "./db.js";

export type AppOptions = {
  prisma: PrismaClient;
  version: string;
  logger?: boolean;
};

export function buildApp({ prisma, version, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  // Liveness for Render and the Docker HEALTHCHECK. Must not touch the database:
  // frequent probes would keep Neon awake and use up its compute hours.
  app.get("/health", () => ({ status: "ok", version }));

  // Explicit database check for CI and manual debugging. Wakes Neon.
  app.get("/health/db", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok", db: "ok", version };
    } catch {
      return reply.code(503).send({ status: "error", db: "error", version });
    }
  });

  return app;
}
