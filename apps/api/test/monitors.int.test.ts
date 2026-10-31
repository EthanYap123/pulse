import { LIMITS } from "@pulse/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createCipher } from "../src/crypto.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma, resetDb } from "./helpers/db.js";
import { signUp, type Session } from "./helpers/session.js";

const prisma = createTestPrisma();
const app = buildApp({ prisma, config: testConfig });

let alice: Session;
let bob: Session;
let aliceProject: string;

type Monitor = {
  id: string;
  url: string;
  status: string;
  isPaused: boolean;
  headerNames: string[];
  [key: string]: unknown;
};

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(prisma);
  alice = await signUp(app, "alice@example.com");
  bob = await signUp(app, "bob@example.com");
  const res = await alice.request({
    method: "POST",
    url: "/v1/projects",
    payload: { name: "Alice", slug: "alice" },
  });
  aliceProject = res.json<{ id: string }>().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function createMonitor(as: Session, projectId: string, payload: Record<string, unknown> = {}) {
  return as.request({
    method: "POST",
    url: `/v1/projects/${projectId}/monitors`,
    payload: { name: "Home", url: "https://example.com", ...payload },
  });
}

describe("monitors", () => {
  it("creates a monitor with defaults and a shard", async () => {
    const res = await createMonitor(alice, aliceProject);
    expect(res.statusCode).toBe(201);
    const monitor = res.json<Monitor>();
    expect(monitor).toMatchObject({
      projectId: aliceProject,
      url: "https://example.com/",
      method: "GET",
      expectedStatus: { min: 200, max: 399 },
      timeoutMs: 8000,
      failureThreshold: 3,
      headerNames: [],
      isPaused: false,
      status: "pending",
      lastCheckedAt: null,
    });
    const row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    expect(row.shard).toBeGreaterThanOrEqual(0);
    expect(row.shard).toBeLessThan(LIMITS.shards);
  });

  it("lists, reads, updates and deletes", async () => {
    const { id } = (await createMonitor(alice, aliceProject)).json<Monitor>();

    const list = await alice.request({
      method: "GET",
      url: `/v1/projects/${aliceProject}/monitors`,
    });
    expect(list.json<{ items: Monitor[] }>().items.map((m) => m.id)).toEqual([id]);

    const patched = await alice.request({
      method: "PATCH",
      url: `/v1/monitors/${id}`,
      payload: { name: "API", timeoutMs: 5000, expectedStatus: { min: 200, max: 204 } },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      name: "API",
      timeoutMs: 5000,
      expectedStatus: { min: 200, max: 204 },
      url: "https://example.com/", // untouched
    });

    expect((await alice.request({ method: "DELETE", url: `/v1/monitors/${id}` })).statusCode).toBe(
      204,
    );
    expect((await alice.request({ method: "GET", url: `/v1/monitors/${id}` })).statusCode).toBe(
      404,
    );
  });

  it("pauses and resumes", async () => {
    const { id } = (await createMonitor(alice, aliceProject)).json<Monitor>();
    const paused = await alice.request({ method: "POST", url: `/v1/monitors/${id}/pause` });
    expect(paused.json()).toMatchObject({ isPaused: true, status: "paused" });
    const resumed = await alice.request({ method: "POST", url: `/v1/monitors/${id}/resume` });
    expect(resumed.json()).toMatchObject({ isPaused: false, status: "pending" });
  });

  it("rejects private and local URLs with a reason", async () => {
    for (const url of ["http://localhost:3000", "http://169.254.169.254/", "http://10.1.2.3"]) {
      const res = await createMonitor(alice, aliceProject, { url });
      expect(res.statusCode).toBe(422);
      const body = res.json<{ errors: { path: string; message: string }[] }>();
      expect(body.errors[0]?.path).toBe("url");
    }
    expect(await prisma.monitor.count()).toBe(0);
  });

  it("rejects a private URL on update too", async () => {
    const { id } = (await createMonitor(alice, aliceProject)).json<Monitor>();
    const res = await alice.request({
      method: "PATCH",
      url: `/v1/monitors/${id}`,
      payload: { url: "http://127.0.0.1/admin" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("encrypts header values and only returns their names", async () => {
    const res = await createMonitor(alice, aliceProject, {
      headers: { Authorization: "Bearer super-secret-token" },
    });
    const monitor = res.json<Monitor>();
    expect(monitor.headerNames).toEqual(["Authorization"]);
    expect(JSON.stringify(monitor)).not.toContain("super-secret-token");

    const row = await prisma.monitor.findUniqueOrThrow({ where: { id: monitor.id } });
    const stored = (row.headers as Record<string, string>).Authorization ?? "";
    expect(stored).not.toContain("super-secret-token");
    expect(createCipher(testConfig.encryptionKey).decrypt(stored)).toBe(
      "Bearer super-secret-token",
    );
  });

  it("caps monitors at 10 per user across projects", async () => {
    const second = await alice.request({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "Second", slug: "alice-two" },
    });
    const secondId = second.json<{ id: string }>().id;
    for (let i = 0; i < 10; i++) {
      const project = i % 2 === 0 ? aliceProject : secondId;
      expect((await createMonitor(alice, project, { name: `m${i}` })).statusCode).toBe(201);
    }
    const eleventh = await createMonitor(alice, aliceProject);
    expect(eleventh.statusCode).toBe(409);
    expect(eleventh.json()).toMatchObject({ limit: "monitors_per_user", max: 10 });
  });

  it("refuses new active monitors when the global cap is reached", async () => {
    // Fill the global cap directly instead of creating 200 users through the API.
    const filler = await prisma.user.create({
      data: { email: "filler@example.com", passwordHash: "x" },
    });
    const project = await prisma.project.create({
      data: { ownerId: filler.id, name: "Filler", slug: "filler" },
    });
    await prisma.monitor.createMany({
      data: Array.from({ length: LIMITS.activeMonitorsGlobal }, (_, i) => ({
        projectId: project.id,
        name: `f${i}`,
        url: "https://example.com",
        shard: i % LIMITS.shards,
      })),
    });

    const res = await createMonitor(alice, aliceProject);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ limit: "active_monitors", max: 200 });

    // Pausing one frees a slot.
    const one = await prisma.monitor.findFirstOrThrow({ where: { projectId: project.id } });
    await prisma.monitor.update({ where: { id: one.id }, data: { isPaused: true } });
    expect((await createMonitor(alice, aliceProject)).statusCode).toBe(201);
  });

  it("won't resume a paused monitor past the global cap", async () => {
    const { id } = (await createMonitor(alice, aliceProject)).json<Monitor>();
    await alice.request({ method: "POST", url: `/v1/monitors/${id}/pause` });

    const filler = await prisma.user.create({
      data: { email: "filler@example.com", passwordHash: "x" },
    });
    const project = await prisma.project.create({
      data: { ownerId: filler.id, name: "Filler", slug: "filler" },
    });
    await prisma.monitor.createMany({
      data: Array.from({ length: LIMITS.activeMonitorsGlobal }, (_, i) => ({
        projectId: project.id,
        name: `f${i}`,
        url: "https://example.com",
        shard: i % LIMITS.shards,
      })),
    });

    const res = await alice.request({ method: "POST", url: `/v1/monitors/${id}/resume` });
    expect(res.statusCode).toBe(409);
  });

  it("deleting a project deletes its monitors", async () => {
    await createMonitor(alice, aliceProject);
    await alice.request({ method: "DELETE", url: `/v1/projects/${aliceProject}` });
    expect(await prisma.monitor.count()).toBe(0);
  });
});

describe("tenant isolation for monitors", () => {
  it("hides another user's monitors on every route", async () => {
    const { id } = (await createMonitor(alice, aliceProject)).json<Monitor>();

    const attempts = [
      bob.request({ method: "GET", url: `/v1/monitors/${id}` }),
      bob.request({ method: "PATCH", url: `/v1/monitors/${id}`, payload: { name: "hacked" } }),
      bob.request({ method: "POST", url: `/v1/monitors/${id}/pause` }),
      bob.request({ method: "POST", url: `/v1/monitors/${id}/resume` }),
      bob.request({ method: "DELETE", url: `/v1/monitors/${id}` }),
      bob.request({ method: "GET", url: `/v1/projects/${aliceProject}/monitors` }),
      createMonitor(bob, aliceProject),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.statusCode).toBe(404);
    }

    const row = await prisma.monitor.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name: "Home", isPaused: false });
    expect(await prisma.monitor.count()).toBe(1);
  });
});
