import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import type { PrismaClient } from "./db.js";
import { registerErrorHandling } from "./errors.js";
import { createRepositories } from "./repositories/index.js";
import { authRoutes } from "./routes/auth.js";

export type AppOptions = {
  prisma: PrismaClient;
  config: Config;
  logger?: boolean;
};

export function buildApp({ prisma, config, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  const repos = createRepositories(prisma);

  app.decorateRequest("userId", "");
  void app.register(cookie);
  registerErrorHandling(app);

  // Liveness for Render and the Docker HEALTHCHECK. Must not touch the database:
  // frequent probes would keep Neon awake and use up its compute hours.
  app.get("/health", () => ({ status: "ok", version: config.version }));

  // Explicit database check for CI and manual debugging. Wakes Neon.
  app.get("/health/db", async (_request, reply) => {
    try {
      await repos.health.ping();
      return { status: "ok", db: "ok", version: config.version };
    } catch {
      return reply.code(503).send({ status: "error", db: "error", version: config.version });
    }
  });

  authRoutes(app, repos, config);

  return app;
}
