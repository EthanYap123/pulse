import { signRequest, type CheckerMonitor, type LiveStatus } from "@pulse/shared";

/** Talks to the checker Worker's /internal endpoints (docs/API.md, "Checker endpoints"). */
export interface CheckerClient {
  /** Pushes a monitor's config to its shard. Returns false if the checker couldn't be reached. */
  sync(monitor: CheckerMonitor): Promise<boolean>;
  remove(monitorId: string, shard: number): Promise<boolean>;
  /** Live status per monitor, or null if the checker couldn't be reached. */
  live(monitors: { id: string; shard: number }[]): Promise<Map<string, LiveStatus> | null>;
}

export type CheckerClientOptions = {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  log?: (message: string, error: unknown) => void;
};

/**
 * A failed call never fails the user's request: the checker reconciles its config from
 * Postgres every hour, and the dashboard falls back to the last stored status.
 */
export function createCheckerClient(options: CheckerClientOptions): CheckerClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const base = options.url.replace(/\/$/, "");

  async function call(method: string, path: string, body?: unknown): Promise<Response | null> {
    const text = body === undefined ? "" : JSON.stringify(body);
    try {
      const headers = await signRequest(options.secret, method, path, text);
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { ...headers, ...(text ? { "content-type": "application/json" } : {}) },
        body: text || undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        options.log?.(`checker ${method} ${path} returned ${res.status}`, null);
        return null;
      }
      return res;
    } catch (error) {
      options.log?.(`checker ${method} ${path} failed`, error);
      return null;
    }
  }

  return {
    async sync(monitor) {
      return (await call("POST", "/internal/v1/monitors/sync", { monitor })) !== null;
    },

    async remove(monitorId, shard) {
      return (await call("DELETE", `/internal/v1/monitors/${monitorId}?shard=${shard}`)) !== null;
    },

    async live(monitors) {
      if (monitors.length === 0) return new Map();
      const res = await call("POST", "/internal/v1/live", { monitors });
      if (!res) return null;
      const { items } = (await res.json()) as { items: LiveStatus[] };
      return new Map(items.map((item) => [item.monitorId, item]));
    },
  };
}
