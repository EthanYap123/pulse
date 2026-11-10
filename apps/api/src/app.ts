import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { requireAuth } from "./auth/authenticate.js";
import { createCheckerClient, type CheckerClient } from "./checker-client.js";
import type { Config } from "./config.js";
import { createCipher } from "./crypto.js";
import type { PrismaClient } from "./db.js";
import { registerErrorHandling } from "./errors.js";
import { createRepositories } from "./repositories/index.js";
import { authRoutes } from "./routes/auth.js";
import { channelRoutes } from "./routes/channels.js";
import { incidentRoutes } from "./routes/incidents.js";
import { monitorRoutes } from "./routes/monitors.js";
import { projectRoutes } from "./routes/projects.js";

export type AppOptions = {
  prisma: PrismaClient;
  config: Config;
  logger?: boolean;
  /** Overrides the client built from `config.checker` (tests pass a fake). */
  checker?: CheckerClient | null;
  /** Outbound fetch for alert test messages (tests pass a fake). */
  alertFetch?: typeof fetch;
};

export function buildApp({
  prisma,
  config,
  logger = false,
  ...options
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  const repos = createRepositories(prisma, createCipher(config.encryptionKey));
  const checker =
    options.checker !== undefined
      ? options.checker
      : config.checker &&
        createCheckerClient({
          ...config.checker,
          log: (message, error) => app.log.warn({ err: error }, message),
        });

  app.decorateRequest("userId", "");
  void app.register(cookie);
  registerErrorHandling(app);

  // Liveness for Render and the Docker HEALTHCHECK. Must not touch the database:
  // frequent probes would keep Neon awake and use up its compute hours.
  app.get("/health", () => ({ status: "ok", version: config.version, commit: config.commit }));

  // Explicit database check for CI and manual debugging. Wakes Neon.
  app.get("/health/db", async (_request, reply) => {
    try {
      await repos.health.ping();
      return { status: "ok", db: "ok", version: config.version, commit: config.commit };
    } catch {
      return reply
        .code(503)
        .send({ status: "error", db: "error", version: config.version, commit: config.commit });
    }
  });

  authRoutes(app, repos, config);

  // Everything registered in here needs a valid access token.
  void app.register((scope, _opts, done) => {
    scope.addHook("preHandler", requireAuth(config.jwtSecret));
    projectRoutes(scope, repos, checker);
    monitorRoutes(scope, repos, checker);
    incidentRoutes(scope, repos, checker);
    channelRoutes(scope, repos, options.alertFetch ?? ((input, init) => fetch(input, init)));
    done();
  });

  return app;
}
