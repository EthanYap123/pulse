import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api.js";

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function setup(handler: Handler, initialToken: string | null = "old-token") {
  let token = initialToken;
  const fetch = vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
  const api = createApi({
    getToken: () => token,
    setToken: (t) => {
      token = t;
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { api, fetch, token: () => token };
}

const authHeader = (init: RequestInit) =>
  (init.headers as Record<string, string> | undefined)?.authorization;

describe("createApi", () => {
  it("sends the bearer token and JSON body to /api/v1", async () => {
    const { api, fetch } = setup(() => Response.json({ id: "p1" }, { status: 201 }));
    expect(await api.post("/projects", { name: "x" })).toEqual({ id: "p1" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/api/v1/projects");
    expect(authHeader(init)).toBe("Bearer old-token");
    expect(init.body).toBe('{"name":"x"}');
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const { api, fetch, token } = setup((url, init) => {
      if (url.endsWith("/auth/refresh")) return Response.json({ accessToken: "new-token" });
      return authHeader(init) === "Bearer new-token"
        ? Response.json({ ok: true })
        : new Response(null, { status: 401 });
    });
    expect(await api.get("/me")).toEqual({ ok: true });
    expect(token()).toBe("new-token");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("shares one refresh between concurrent 401s", async () => {
    let refreshes = 0;
    const { api } = setup((url, init) => {
      if (url.endsWith("/auth/refresh")) {
        refreshes++;
        return Response.json({ accessToken: "new-token" });
      }
      return authHeader(init) === "Bearer new-token"
        ? Response.json({ ok: true })
        : new Response(null, { status: 401 });
    });
    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    expect(refreshes).toBe(1);
  });

  it("clears the token and throws when the session has ended", async () => {
    const { api, token } = setup(() =>
      Response.json({ code: "unauthenticated", title: "Sign in" }, { status: 401 }),
    );
    await expect(api.get("/me")).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
    expect(token()).toBeNull();
  });

  it("reports a session as ended only when the API says so", async () => {
    const onSessionEnded = vi.fn();
    const answer = (fetch: () => Promise<Response>) =>
      createApi({
        getToken: () => null,
        setToken: () => undefined,
        onSessionEnded,
        fetch,
      });

    await answer(() => Promise.reject(new Error("offline"))).refresh();
    await answer(() => Promise.resolve(new Response(null, { status: 503 }))).refresh();
    expect(onSessionEnded).not.toHaveBeenCalled();

    await answer(() => Promise.resolve(new Response(null, { status: 401 }))).refresh();
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it("turns problem details into an ApiError with field errors", async () => {
    const { api } = setup(() =>
      Response.json(
        {
          code: "validation_failed",
          title: "Validation failed",
          errors: [{ path: "url", message: "Private addresses can't be monitored" }],
        },
        { status: 422 },
      ),
    );
    const error = (await api.post("/projects/x/monitors", {}).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.errors).toEqual([
      { path: "url", message: "Private addresses can't be monitored" },
    ]);
  });

  it("returns undefined for 204", async () => {
    const { api } = setup(() => new Response(null, { status: 204 }));
    expect(await api.del("/monitors/1")).toBeUndefined();
  });

  it("reports slow requests so the UI can say the API is waking up", async () => {
    const onSlow = vi.fn();
    const api = createApi({
      getToken: () => null,
      setToken: () => undefined,
      onSlow,
      slowAfterMs: 5,
      fetch: (() =>
        new Promise((r) => setTimeout(() => r(Response.json({})), 30))) as unknown as typeof fetch,
    });
    await api.get("/health");
    expect(onSlow.mock.calls.map((c) => c[0] as boolean)).toEqual([true, false]);
  });
});
