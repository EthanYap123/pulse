import { LIMITS } from "@pulse/shared";
import type { Env } from "./env.js";
import { createRouter } from "./routes.js";

export { Shard } from "./shard.js";

function shardStub(env: Env, index: number) {
  return env.SHARD.get(env.SHARD.idFromName(`shard-${index}`));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const handle = createRouter({
      shardCount: LIMITS.shards,
      hmacSecret: env.CHECKER_HMAC_SECRET,
      environment: env.ENVIRONMENT ?? "local",
      shard: (i) => {
        const stub = shardStub(env, i);
        return {
          upsert: (monitor) => stub.upsert(monitor),
          remove: (id) => stub.remove(id),
          live: (ids) => stub.live(ids),
          flush: () => stub.flush(i),
        };
      },
    });
    return handle(request);
  },

  /** Every 5 minutes: each shard checks its monitors (and flushes to Postgres at :00). */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const results = await Promise.allSettled(
      Array.from({ length: LIMITS.shards }, (_, i) =>
        shardStub(env, i).tick(i, controller.scheduledTime),
      ),
    );
    console.log(
      JSON.stringify({
        msg: "tick",
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        shards: results.map((r) =>
          r.status === "fulfilled" ? r.value : { kind: "error", error: String(r.reason) },
        ),
      }),
    );
  },
} satisfies ExportedHandler<Env>;
