import { LIMITS } from "./limits.js";

/**
 * Which checker shard owns a monitor (docs/ARCHITECTURE.md §3.1). FNV-1a over the id,
 * so the same id always maps to the same shard in every app.
 */
export function shardFor(monitorId: string, shards: number = LIMITS.shards): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < monitorId.length; i++) {
    hash ^= monitorId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shards;
}
