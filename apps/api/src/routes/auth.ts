import type { FastifyInstance, FastifyReply } from "fastify";
import { LIMITS, credentialsSchema, loginSchema } from "@pulse/shared";
import { requireAuth } from "../auth/authenticate.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../auth/passwords.js";
import {
  REFRESH_TOKEN_TTL_MS,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
} from "../auth/tokens.js";
import type { Config } from "../config.js";
import { AppError, unauthenticated } from "../errors.js";
import type { Repositories } from "../repositories/index.js";
import type { UserRecord } from "../repositories/users.js";

export const REFRESH_COOKIE = "pulse_rt";

function toUser(user: UserRecord) {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

export function authRoutes(app: FastifyInstance, repos: Repositories, config: Config): void {
  const cookieOptions = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: "lax" as const,
    path: config.cookie.path,
  };

  function setRefreshCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(REFRESH_COOKIE, token, {
      ...cookieOptions,
      maxAge: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
    });
  }

  function clearRefreshCookie(reply: FastifyReply): void {
    reply.clearCookie(REFRESH_COOKIE, cookieOptions);
  }

  async function startSession(reply: FastifyReply, userId: string): Promise<string> {
    const refresh = newRefreshToken();
    await repos.refreshTokens.issue(
      userId,
      refresh.hash,
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );
    setRefreshCookie(reply, refresh.token);
    return signAccessToken(userId, config.jwtSecret);
  }

  app.post("/v1/auth/signup", async (request, reply) => {
    const { email, password } = credentialsSchema.parse(request.body);
    const user = await repos.users.create(email, await hashPassword(password));
    if (!user) {
      // Deliberately vague. Fully hiding whether an email is registered needs email
      // verification, which is out of scope for v1 (docs/PRD.md).
      throw new AppError(409, "signup_failed", "Couldn't create an account with those details");
    }
    const accessToken = await startSession(reply, user.id);
    return reply.code(201).send({ user: toUser(user), accessToken });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const { email, password } = loginSchema.parse(request.body);
    const user = await repos.users.findByEmail(email);
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!user || !ok) {
      throw new AppError(401, "invalid_credentials", "Email or password is incorrect");
    }
    const accessToken = await startSession(reply, user.id);
    return { user: toUser(user), accessToken };
  });

  app.post("/v1/auth/refresh", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (!presented) throw unauthenticated("No session");

    const next = newRefreshToken();
    const result = await repos.refreshTokens.rotate(
      hashRefreshToken(presented),
      next.hash,
      new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    );
    if (result.kind !== "rotated") {
      clearRefreshCookie(reply);
      throw new AppError(401, "session_expired", "Your session has ended. Sign in again.");
    }
    setRefreshCookie(reply, next.token);
    return { accessToken: await signAccessToken(result.userId, config.jwtSecret) };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const presented = request.cookies[REFRESH_COOKIE];
    if (presented) await repos.refreshTokens.revokeByHash(hashRefreshToken(presented));
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  app.get("/v1/me", { preHandler: requireAuth(config.jwtSecret) }, async (request) => {
    const user = await repos.users.findById(request.userId);
    if (!user) throw unauthenticated();
    const usage = await repos.users.usage(user.id);
    return {
      ...toUser(user),
      usage,
      limits: { projects: LIMITS.projectsPerUser, monitors: LIMITS.monitorsPerUser },
    };
  });
}
