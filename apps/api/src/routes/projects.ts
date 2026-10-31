import { LIMITS, projectInputSchema, projectPatchSchema } from "@pulse/shared";
import type { FastifyInstance } from "fastify";
import { AppError, notFound } from "../errors.js";
import type { Repositories } from "../repositories/index.js";
import { idParam } from "./params.js";

type ProjectRow = NonNullable<Awaited<ReturnType<Repositories["projects"]["get"]>>>;

function toProject(p: ProjectRow) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    isPublic: p.isPublic,
    statusNote: p.statusNote,
    monitorCount: p._count.monitors,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const slugTaken = () => new AppError(409, "conflict", "That status page address is already taken");

/** Registered inside the authenticated scope in app.ts. */
export function projectRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get("/v1/projects", async (request) => {
    const projects = await repos.projects.list(request.userId);
    return { items: projects.map(toProject) };
  });

  app.post("/v1/projects", async (request, reply) => {
    const input = projectInputSchema.parse(request.body);
    const result = await repos.projects.create(request.userId, input);
    if (result.kind === "slug_taken") throw slugTaken();
    if (result.kind === "limit_reached") {
      throw new AppError(
        409,
        "limit_reached",
        `You can have up to ${LIMITS.projectsPerUser} projects`,
        {
          limit: "projects_per_user",
          max: LIMITS.projectsPerUser,
        },
      );
    }
    const project = await repos.projects.get(request.userId, result.id);
    return reply.code(201).send(toProject(project!));
  });

  app.get("/v1/projects/:projectId", async (request) => {
    const project = await repos.projects.get(request.userId, idParam(request.params, "projectId"));
    if (!project) throw notFound();
    return toProject(project);
  });

  app.patch("/v1/projects/:projectId", async (request) => {
    const id = idParam(request.params, "projectId");
    const patch = projectPatchSchema.parse(request.body);
    const result = await repos.projects.update(request.userId, id, patch);
    if (result.kind === "not_found") throw notFound();
    if (result.kind === "slug_taken") throw slugTaken();
    return toProject((await repos.projects.get(request.userId, id))!);
  });

  app.delete("/v1/projects/:projectId", async (request, reply) => {
    const deleted = await repos.projects.delete(
      request.userId,
      idParam(request.params, "projectId"),
    );
    if (!deleted) throw notFound();
    return reply.code(204).send();
  });
}
