import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma, resetDb } from "./helpers/db.js";
import { signUp, type Session } from "./helpers/session.js";

const prisma = createTestPrisma();
const app = buildApp({ prisma, config: testConfig });

let alice: Session;
let projectId: string;
let monitorId: string;

type Incident = {
  id: string;
  monitorName: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSec: number | null;
  cause: string;
  resolveReason: string | null;
  note: string | null;
};

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(prisma);
  alice = await signUp(app, "alice@example.com");
  projectId = (
    await alice.request({
      method: "POST",
      url: "/v1/projects",
      payload: { name: "A", slug: "alice" },
    })
  ).json<{ id: string }>().id;
  monitorId = (
    await alice.request({
      method: "POST",
      url: `/v1/projects/${projectId}/monitors`,
      payload: { name: "Home", url: "https://example.com" },
    })
  ).json<{ id: string }>().id;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/** Incidents are written by the checker; tests insert them directly. */
function incident(startedAt: string, resolvedAt: string | null = null) {
  return prisma.incident.create({
    data: {
      monitorId,
      startedAt: new Date(startedAt),
      resolvedAt: resolvedAt && new Date(resolvedAt),
      resolveReason: resolvedAt ? "recovered" : null,
      cause: "timeout",
    },
  });
}

describe("database rules", () => {
  it("allows only one open incident per monitor", async () => {
    await incident("2026-11-01T10:00:00Z");
    await expect(incident("2026-11-01T11:00:00Z")).rejects.toThrow();
    // Resolved ones don't count.
    await incident("2026-11-01T08:00:00Z", "2026-11-01T08:30:00Z");
  });

  it("refuses a resolve time before the start", async () => {
    await expect(incident("2026-11-01T10:00:00Z", "2026-11-01T09:00:00Z")).rejects.toThrow(
      /incidents_resolved_after_start/,
    );
  });
});

describe("GET /v1/projects/:id/incidents", () => {
  it("lists newest first with duration, and filters by status", async () => {
    await incident("2026-11-01T08:00:00Z", "2026-11-01T08:15:00Z");
    await incident("2026-11-01T10:00:00Z");

    const all = await alice.request({ method: "GET", url: `/v1/projects/${projectId}/incidents` });
    const items = all.json<{ items: Incident[] }>().items;
    expect(items.map((i) => [i.monitorName, i.resolvedAt === null, i.durationSec])).toEqual([
      ["Home", true, null],
      ["Home", false, 900],
    ]);

    const open = await alice.request({
      method: "GET",
      url: `/v1/projects/${projectId}/incidents?status=open`,
    });
    expect(open.json<{ items: Incident[] }>().items).toHaveLength(1);
    const resolved = await alice.request({
      method: "GET",
      url: `/v1/projects/${projectId}/incidents?status=resolved`,
    });
    expect(resolved.json<{ items: Incident[] }>().items[0]?.resolveReason).toBe("recovered");
  });

  it("pages with a cursor", async () => {
    for (let h = 1; h <= 5; h++) {
      await incident(`2026-11-01T0${h}:00:00Z`, `2026-11-01T0${h}:10:00Z`);
    }
    const url = `/v1/projects/${projectId}/incidents?limit=2`;
    const first = (await alice.request({ method: "GET", url })).json<{
      items: Incident[];
      nextCursor: string;
    }>();
    const second = (
      await alice.request({ method: "GET", url: `${url}&cursor=${first.nextCursor}` })
    ).json<{ items: Incident[]; nextCursor: string | null }>();
    const third = (
      await alice.request({ method: "GET", url: `${url}&cursor=${second.nextCursor}` })
    ).json<{ items: Incident[]; nextCursor: string | null }>();
    const hours = [...first.items, ...second.items, ...third.items].map((i) =>
      new Date(i.startedAt).getUTCHours(),
    );
    expect(hours).toEqual([5, 4, 3, 2, 1]);
    expect(third.nextCursor).toBeNull();
  });
});

describe("incident detail and notes", () => {
  it("adds and clears a note", async () => {
    const { id } = await incident("2026-11-01T10:00:00Z", "2026-11-01T10:20:00Z");
    const url = `/v1/incidents/${id}`;
    const set = await alice.request({
      method: "PATCH",
      url,
      payload: { note: " DNS provider outage " },
    });
    expect(set.json()).toMatchObject({ note: "DNS provider outage" });
    const cleared = await alice.request({ method: "PATCH", url, payload: { note: "" } });
    expect(cleared.json()).toMatchObject({ note: null });
    expect((await alice.request({ method: "GET", url })).json()).toMatchObject({ id, note: null });
  });

  it("limits notes to 500 characters", async () => {
    const { id } = await incident("2026-11-01T10:00:00Z");
    const res = await alice.request({
      method: "PATCH",
      url: `/v1/incidents/${id}`,
      payload: { note: "x".repeat(501) },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("monitors and incidents", () => {
  it("shows the open incident's id on the monitor", async () => {
    const open = await incident("2026-11-01T10:00:00Z");
    const res = await alice.request({ method: "GET", url: `/v1/monitors/${monitorId}` });
    expect(res.json()).toMatchObject({ openIncidentId: open.id });
  });

  it("pausing resolves the open incident with reason 'paused'", async () => {
    const open = await incident("2026-11-01T10:00:00Z");
    await alice.request({ method: "POST", url: `/v1/monitors/${monitorId}/pause` });
    const row = await prisma.incident.findUniqueOrThrow({ where: { id: open.id } });
    expect(row.resolveReason).toBe("paused");
    expect(row.resolvedAt).not.toBeNull();
    const monitor = await alice.request({ method: "GET", url: `/v1/monitors/${monitorId}` });
    expect(monitor.json()).toMatchObject({ openIncidentId: null });
  });

  it("deleting the monitor deletes its incidents", async () => {
    await incident("2026-11-01T10:00:00Z");
    await alice.request({ method: "DELETE", url: `/v1/monitors/${monitorId}` });
    expect(await prisma.incident.count()).toBe(0);
  });
});

describe("tenant isolation for incidents", () => {
  it("hides another user's incidents on every route", async () => {
    const { id } = await incident("2026-11-01T10:00:00Z");
    const bob = await signUp(app, "bob@example.com");
    const attempts = [
      bob.request({ method: "GET", url: `/v1/projects/${projectId}/incidents` }),
      bob.request({ method: "GET", url: `/v1/incidents/${id}` }),
      bob.request({ method: "PATCH", url: `/v1/incidents/${id}`, payload: { note: "hacked" } }),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
    expect((await prisma.incident.findUniqueOrThrow({ where: { id } })).note).toBeNull();
  });
});
