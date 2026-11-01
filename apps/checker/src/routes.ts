import {
  checkerMonitorSchema,
  liveRequestSchema,
  verifyRequest,
  type CheckerMonitor,
  type LiveStatus,
} from "@pulse/shared";
import { z } from "zod";

/** What the routes need from a shard. In production these are Durable Object RPC stubs. */
export interface ShardClient {
  upsert(monitor: CheckerMonitor): Promise<void>;
  remove(monitorId: string): Promise<void>;
  live(monitorIds: string[]): Promise<LiveStatus[]>;
  flush(): Promise<{ flushed: number }>;
}

export type RouterDeps = {
  shardCount: number;
  shard: (index: number) => ShardClient;
  hmacSecret: string | undefined;
  environment: string;
  now?: () => number;
};

const syncBodySchema = z.object({ monitor: checkerMonitorSchema });

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** HTTP surface of the checker Worker (docs/API.md, "Checker endpoints"). */
export function createRouter(deps: RouterDeps) {
  const validShard = (n: number) => Number.isInteger(n) && n >= 0 && n < deps.shardCount;

  async function authorised(request: Request, url: URL, body: string): Promise<boolean> {
    if (!deps.hmacSecret) return false;
    return verifyRequest(
      deps.hmacSecret,
      request.method,
      url.pathname + url.search,
      body,
      {
        timestamp: request.headers.get("x-pulse-timestamp"),
        signature: request.headers.get("x-pulse-signature"),
      },
      deps.now?.(),
    );
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", environment: deps.environment });
    }
    if (!url.pathname.startsWith("/internal/v1/")) return json({ error: "not_found" }, 404);

    if (!deps.hmacSecret) return json({ error: "internal_api_disabled" }, 503);
    const body = await request.text();
    if (!(await authorised(request, url, body))) return json({ error: "unauthorised" }, 401);

    let parsed: unknown;
    try {
      parsed = body ? (JSON.parse(body) as unknown) : null;
    } catch {
      return json({ error: "bad_json" }, 400);
    }

    if (request.method === "POST" && url.pathname === "/internal/v1/monitors/sync") {
      const result = syncBodySchema.safeParse(parsed);
      if (!result.success || !validShard(result.data.monitor.shard)) {
        return json({ error: "invalid_monitor" }, 422);
      }
      await deps.shard(result.data.monitor.shard).upsert(result.data.monitor);
      return new Response(null, { status: 204 });
    }

    const removeMatch = /^\/internal\/v1\/monitors\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (request.method === "DELETE" && removeMatch) {
      const shard = Number(url.searchParams.get("shard"));
      if (!validShard(shard)) return json({ error: "invalid_shard" }, 422);
      await deps.shard(shard).remove(removeMatch[1]!);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/internal/v1/live") {
      const result = liveRequestSchema.safeParse(parsed);
      if (!result.success || !result.data.monitors.every((m) => validShard(m.shard))) {
        return json({ error: "invalid_request" }, 422);
      }
      const byShard = new Map<number, string[]>();
      for (const m of result.data.monitors) {
        byShard.set(m.shard, [...(byShard.get(m.shard) ?? []), m.id]);
      }
      const items = await Promise.all(
        [...byShard].map(([shard, ids]) => deps.shard(shard).live(ids)),
      );
      return json({ items: items.flat() });
    }

    if (request.method === "POST" && url.pathname === "/internal/v1/flush") {
      const results = await Promise.all(
        Array.from({ length: deps.shardCount }, (_, i) => deps.shard(i).flush()),
      );
      return json({ flushed: results.reduce((n, r) => n + r.flushed, 0) });
    }

    return json({ error: "not_found" }, 404);
  };
}
