import type { Shard } from "./shard.js";

export type Env = {
  SHARD: DurableObjectNamespace<Shard>;
  ENVIRONMENT?: string;
  /** "pg" for local Postgres; anything else uses Neon's HTTP driver. */
  DB_DRIVER?: string;
  DATABASE_URL: string;
  /** Shared with the API; signs /internal requests. */
  CHECKER_HMAC_SECRET?: string;
  /** Shared with the API; decrypts monitor header values. */
  ENCRYPTION_KEY?: string;
};
