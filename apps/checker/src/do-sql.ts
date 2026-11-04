import type { Sql } from "./shard-core.js";

/** Durable Object SQLite behind the small Sql interface the logic classes use. */
export function doSql(storage: DurableObjectStorage): Sql {
  return {
    all: <T>(query: string, ...params: (string | number | null)[]) =>
      storage.sql.exec(query, ...params).toArray() as T[],
    run: (query, ...params) => {
      storage.sql.exec(query, ...params);
    },
  };
}
