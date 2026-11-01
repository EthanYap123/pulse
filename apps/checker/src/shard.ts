import { DurableObject } from "cloudflare:workers";
import type { CheckerMonitor, LiveStatus } from "@pulse/shared";
import { createDecrypt } from "./crypto.js";
import { connectDb } from "./db.js";
import type { Env } from "./env.js";
import { ShardCore, type Sql, type TickResult } from "./shard-core.js";

function doSql(storage: DurableObjectStorage): Sql {
  return {
    all: <T>(query: string, ...params: (string | number | null)[]) =>
      storage.sql.exec(query, ...params).toArray() as T[],
    run: (query, ...params) => {
      storage.sql.exec(query, ...params);
    },
  };
}

const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));

/**
 * Durable Object for one checker shard. The logic lives in ShardCore; this class only
 * wires it to Durable Object storage, the environment and RPC.
 */
export class Shard extends DurableObject<Env> {
  private core: Promise<ShardCore> | undefined;

  /** The shard number is stored on first use, since the object can't read its own name. */
  private getCore(shard?: number): Promise<ShardCore> {
    const storage = this.ctx.storage;
    if (shard !== undefined) storage.kv.put("shard", shard);
    this.core ??= (async () => {
      const decrypt = this.env.ENCRYPTION_KEY ? await createDecrypt(this.env.ENCRYPTION_KEY) : null;
      return new ShardCore(doSql(storage), {
        shard: storage.kv.get<number>("shard") ?? 0,
        fetch: (input, init) => fetch(input, init),
        now: () => Date.now(),
        openDb: () => connectDb(this.env.DB_DRIVER, this.env.DATABASE_URL),
        decrypt,
        log,
      });
    })();
    return this.core;
  }

  async tick(shard: number, scheduledTime: number): Promise<TickResult> {
    return (await this.getCore(shard)).tick(scheduledTime);
  }

  async flush(shard: number): Promise<{ flushed: number }> {
    return (await this.getCore(shard)).flush();
  }

  async upsert(monitor: CheckerMonitor): Promise<void> {
    (await this.getCore(monitor.shard)).upsert(monitor);
  }

  async remove(monitorId: string): Promise<void> {
    (await this.getCore()).remove(monitorId);
  }

  async live(monitorIds: string[]): Promise<LiveStatus[]> {
    return (await this.getCore()).live(monitorIds);
  }
}
