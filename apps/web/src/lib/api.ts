/**
 * Browser client for the Pulse API. Every call goes to /api/v1 on this origin (Next.js
 * proxies it to Fastify), so the refresh-token cookie stays first-party.
 */

export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    title: string,
    readonly errors: FieldError[] = [],
  ) {
    super(title);
  }
}

export type ApiOptions = {
  getToken: () => string | null;
  setToken: (token: string | null) => void;
  /** The API said the session is over (not just unreachable). */
  onSessionEnded?: () => void;
  /** Called with true when a request is still waiting after 3 s (the API may be waking up). */
  onSlow?: (slow: boolean) => void;
  fetch?: typeof fetch;
  slowAfterMs?: number;
};

export function createApi(options: ApiOptions) {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const slowAfterMs = options.slowAfterMs ?? 3000;
  let refreshing: Promise<string | null> | null = null;

  /**
   * Trades the refresh cookie for a new access token. Concurrent callers share one request:
   * two refreshes with the same cookie would look like token reuse and end the session.
   */
  function refresh(): Promise<string | null> {
    refreshing ??= (async () => {
      try {
        const res = await doFetch("/api/v1/auth/refresh", {
          method: "POST",
          credentials: "same-origin",
        });
        const token = res.ok ? ((await res.json()) as { accessToken: string }).accessToken : null;
        if (res.status === 401) options.onSessionEnded?.();
        options.setToken(token);
        return token;
      } catch {
        options.setToken(null);
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    retry = true,
  ): Promise<T> {
    const slowTimer = setTimeout(() => options.onSlow?.(true), slowAfterMs);
    try {
      const token = options.getToken();
      const res = await doFetch(`/api/v1${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      // Access tokens last 15 minutes; refresh once and retry before giving up.
      if (res.status === 401 && retry && !path.startsWith("/auth/")) {
        if (await refresh()) return request<T>(method, path, body, false);
      }
      if (res.status === 204) return undefined as T;

      const data = (await res.json().catch(() => null)) as
        (T & { code?: string; title?: string; errors?: FieldError[] }) | null;
      if (!res.ok) {
        throw new ApiError(
          res.status,
          data?.code ?? "error",
          data?.title ?? `Request failed (${res.status})`,
          data?.errors,
        );
      }
      return data as T;
    } finally {
      clearTimeout(slowTimer);
      options.onSlow?.(false);
    }
  }

  return {
    refresh,
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
    del: (path: string) => request<void>("DELETE", path),
  };
}

export type Api = ReturnType<typeof createApi>;
