import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

const PROBLEM_TYPE = "https://github.com/EthanYap123/pulse/blob/main/docs/API.md#errors";

/** An error that maps directly to an RFC 9457 problem response. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(title);
  }
}

export const notFound = () => new AppError(404, "not_found", "Not found");
export const unauthenticated = (title = "Sign in to continue") =>
  new AppError(401, "unauthenticated", title);

type Problem = {
  type: string;
  title: string;
  status: number;
  code: string;
  [key: string]: unknown;
};

function problem(status: number, code: string, title: string, extra = {}): Problem {
  return { type: PROBLEM_TYPE, title, status, code, ...extra };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    let body: Problem;
    if (error instanceof AppError) {
      body = problem(error.status, error.code, error.title, error.extra);
    } else if (error instanceof ZodError) {
      body = problem(422, "validation_failed", "Validation failed", {
        errors: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    } else if (typeof error.statusCode === "number" && error.statusCode < 500) {
      // Fastify's own client errors, such as malformed JSON or an unsupported content type.
      body = problem(error.statusCode, "bad_request", error.message);
    } else {
      request.log.error(error);
      body = problem(500, "internal", "Something went wrong");
    }
    return reply.code(body.status).type("application/problem+json").send(body);
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .type("application/problem+json")
      .send(problem(404, "not_found", "Not found")),
  );
}
