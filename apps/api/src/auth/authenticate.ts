import type { FastifyRequest } from "fastify";
import { unauthenticated } from "../errors.js";
import { verifyAccessToken } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireAuth`; empty on unauthenticated routes. */
    userId: string;
  }
}

/** preHandler that accepts `Authorization: Bearer <access token>` and sets `request.userId`. */
export function requireAuth(jwtSecret: string) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const userId = token ? await verifyAccessToken(token, jwtSecret) : null;
    if (!userId) throw unauthenticated();
    request.userId = userId;
  };
}
