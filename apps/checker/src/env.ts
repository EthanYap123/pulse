import type { Shard } from "./shard.js";
import type { Snapshots } from "./snapshots.js";

export type Env = {
  SHARD: DurableObjectNamespace<Shard>;
  SNAPSHOTS: DurableObjectNamespace<Snapshots>;
  ENVIRONMENT?: string;
  /** Commit this Worker was deployed from (`wrangler deploy --var COMMIT:<sha>`). */
  COMMIT?: string;
  /** "pg" for local Postgres; anything else uses Neon's HTTP driver. */
  DB_DRIVER?: string;
  DATABASE_URL: string;
  /** Shared with the API; signs /internal requests. */
  CHECKER_HMAC_SECRET?: string;
  /** Shared with the API; decrypts monitor header values. */
  ENCRYPTION_KEY?: string;
};
