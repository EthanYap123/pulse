import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma, resetDb } from "./helpers/db.js";
import { signUp, type Session } from "./helpers/session.js";

const prisma = createTestPrisma();
const app = buildApp({ prisma, config: testConfig });

let alice: Session;
let bob: Session;

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(prisma);
  alice = await signUp(app, "alice@example.com");
  bob = await signUp(app, "bob@example.com");
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

type Project = { id: string; slug: string; name: string; isPublic: boolean; monitorCount: number };

async function createProject(as: Session, slug: string, name = "My site") {
  return as.request({ method: "POST", url: "/v1/projects", payload: { name, slug } });
}

describe("projects", () => {
  it("creates, lists, reads, updates and deletes a project", async () => {
    const created = await createProject(alice, "Alice-Site");
    expect(created.statusCode).toBe(201);
    const project = created.json<Project>();
    expect(project).toMatchObject({ slug: "alice-site", isPublic: true, monitorCount: 0 });

    const list = await alice.request({ method: "GET", url: "/v1/projects" });
    expect(list.json<{ items: Project[] }>().items.map((p) => p.id)).toEqual([project.id]);

    const updated = await alice.request({
      method: "PATCH",
      url: `/v1/projects/${project.id}`,
      payload: { name: "Renamed", isPublic: false, statusNote: "Planned maintenance" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      name: "Renamed",
      isPublic: false,
      statusNote: "Planned maintenance",
    });

    const deleted = await alice.request({ method: "DELETE", url: `/v1/projects/${project.id}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await alice.request({ method: "GET", url: `/v1/projects/${project.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it("requires a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a slug someone else already uses", async () => {
    await createProject(alice, "shared-name");
    const res = await createProject(bob, "shared-name");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "conflict" });
  });

  it("refuses renaming to a taken slug", async () => {
    await createProject(alice, "first");
    const second = (await createProject(alice, "second")).json<Project>();
    const res = await alice.request({
      method: "PATCH",
      url: `/v1/projects/${second.id}`,
      payload: { slug: "first" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("caps projects at 3 per user", async () => {
    for (const slug of ["one", "two", "three"]) {
      expect((await createProject(alice, slug)).statusCode).toBe(201);
    }
    const fourth = await createProject(alice, "four");
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json()).toMatchObject({
      code: "limit_reached",
      limit: "projects_per_user",
      max: 3,
    });
    // Bob's own cap is unaffected.
    expect((await createProject(bob, "bobs")).statusCode).toBe(201);
  });

  it("holds the cap when several creates arrive at once", async () => {
    const results = await Promise.all(
      ["race-1", "race-2", "race-3", "race-4", "race-5"].map((slug) => createProject(alice, slug)),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(await prisma.project.count()).toBe(3);
  });

  it("validates input", async () => {
    const res = await alice.request({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "", slug: "-bad-", extra: true },
    });
    expect(res.statusCode).toBe(422);
  });

  it("returns 404 for an id that isn't a UUID", async () => {
    const res = await alice.request({ method: "GET", url: "/v1/projects/not-a-uuid" });
    expect(res.statusCode).toBe(404);
  });
});

describe("tenant isolation for projects", () => {
  it("hides another user's project on every route", async () => {
    const project = (await createProject(alice, "alice-only")).json<Project>();
    const url = `/v1/projects/${project.id}`;

    expect((await bob.request({ method: "GET", url })).statusCode).toBe(404);
    expect(
      (await bob.request({ method: "PATCH", url, payload: { name: "hacked" } })).statusCode,
    ).toBe(404);
    expect((await bob.request({ method: "DELETE", url })).statusCode).toBe(404);

    const bobsList = await bob.request({ method: "GET", url: "/v1/projects" });
    expect(bobsList.json<{ items: Project[] }>().items).toEqual([]);

    // Untouched.
    const stillThere = await alice.request({ method: "GET", url });
    expect(stillThere.json()).toMatchObject({ name: "My site" });
  });
});
