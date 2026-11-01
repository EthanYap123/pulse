import { DurableObject } from "cloudflare:workers";

type Env = { PROBE: DurableObjectNamespace<Probe> };
type Burst = { ok: number; error: string | null };

const TARGET = "https://example.com/";

/** Makes up to `n` sequential outbound fetches and stops at the first failure. */
async function burst(n: number): Promise<Burst> {
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try {
      const res = await fetch(TARGET);
      await res.body?.cancel();
      ok++;
    } catch (error) {
      return { ok, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok, error: null };
}

export class Probe extends DurableObject<Env> {
  burst(n: number): Promise<Burst> {
    return burst(n);
  }

  save(key: string, value: unknown): void {
    this.ctx.storage.kv.put(key, JSON.stringify(value));
  }

  load(key: string): unknown {
    const raw = this.ctx.storage.kv.get<string>(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  }
}

async function fanOut(env: Env, shards: number, n: number) {
  const results = await Promise.all(
    Array.from({ length: shards }, (_, i) =>
      env.PROBE.get(env.PROBE.idFromName(`shard-${i}`)).burst(n),
    ),
  );
  return { shards, perShard: n, results };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const n = Number(url.searchParams.get("n") ?? 60);
    const shards = Number(url.searchParams.get("shards") ?? 3);
    if (url.pathname === "/self") return Response.json(await burst(n));
    if (url.pathname === "/fanout") return Response.json(await fanOut(env, shards, n));
    if (url.pathname === "/cron-result") {
      return Response.json(await env.PROBE.get(env.PROBE.idFromName("results")).load("cron"));
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const result = await fanOut(env, 3, 60);
    await env.PROBE.get(env.PROBE.idFromName("results")).save("cron", {
      at: new Date(controller.scheduledTime).toISOString(),
      ...result,
    });
  },
} satisfies ExportedHandler<Env>;
