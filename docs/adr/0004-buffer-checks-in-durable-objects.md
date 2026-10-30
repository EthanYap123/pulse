# ADR-0004: Buffer check results in Durable Objects and flush to Neon hourly

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

The brief describes a checker Worker that "stores results" in Neon on each run. Checking the free-tier limits (see [COSTS.md](../COSTS.md)) shows that doesn't fit:

- Neon Free gives **100 CU-hours per project per month**, shared by all branches. At the minimum size of 0.25 CU, a compute that never sleeps uses `0.25 x 730 = 182.5` CU-hours a month.
- Neon suspends compute after **5 minutes** idle. A checker writing every 5 minutes means it never suspends.
- So writing every tick would exhaust compute around **day 16** of each month, after which the database is suspended until the next month.

There are also Worker limits: **10 ms CPU** per Worker invocation and **50 subrequests**.

Public status pages have the same problem in a different form: if they read Neon on cache misses, traffic decides how long Neon stays awake.

## Decision

1. **Checks run inside 5 shard Durable Objects** (SQLite-backed, available on Workers Free). Each shard keeps, in its own SQLite:
   - its monitors' config,
   - each monitor's state (status, consecutive failure/success counts, first failure time, open incident id),
   - a buffer of results, **one row per tick** holding a JSON array (keeps row writes ~1,440/day vs a 100,000/day limit),
   - the alert outbox.
2. **Neon is written only:**
   - once an hour (flush buffer, reconcile config, rollups, retention, snapshots), and
   - when a monitor changes state (incident opened/resolved), which is rare.
3. **Public status pages read a snapshot**, rebuilt hourly from Neon and stored in a Snapshot Durable Object, merged with live state from the shards. They never touch Neon or the API.
4. Neon stays the **source of truth** for config and history; shard state is a cache that can be rebuilt from Neon (config) or tolerated if lost (at most one hour of raw checks).

Estimated Neon use: ~15.5 CU-hours/month for production flushes, the same for staging, ~48 in total with dashboard use (budget in COSTS.md).

## Consequences

**Good**

- Fits Neon's free compute with about 50% headroom, and stays inside the Workers request, CPU, subrequest and DO-duration limits at the 200-monitor cap.
- Public status pages are fast and keep working when Neon or Render is asleep, or Neon is out of compute.
- Durable Objects run one request at a time per object, which makes incident detection race-free (no duplicate incidents from overlapping ticks).
- DOs get 30 s of CPU per invocation instead of 10 ms.

**Bad**

- **History in Neon is up to 1 hour behind.** The dashboard covers this by showing live status from the checker; the 24 h latency chart lags by up to an hour. The API could ask the shards for their unflushed buffer to fill the gap later.
- **Data loss window:** if a shard's storage were lost, up to an hour of raw checks would be lost (incidents are already in Neon). Accepted.
- **More moving parts** than "Worker writes to Postgres": a sync protocol between API and checker, an hourly reconcile, and two kinds of storage.
- **Unverified limit:** Cloudflare's docs don't say whether a Durable Object invoked from the cron Worker has its own 50-subrequest budget. The Phase 2 spike measures this; if it's shared, the global cap drops to 40 monitors.
- Durable Objects tie the checker to Cloudflare more tightly than a plain Worker would.

## Alternatives considered

| Option                                                  | Why not                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Write to Neon every tick                                | ~182 CU-hours/month vs 100 free                                                                                                                 |
| Check every 15+ minutes so Neon can sleep between ticks | Still ~40% awake (~73 CU-hours) before any dashboard or staging use, and 45-minute outage detection is too slow                                 |
| Buffer in Workers KV                                    | Free plan allows 1,000 writes/day and 1 write/second per key, and KV is eventually consistent, so counters read on the next tick could be stale |
| Cloudflare D1 as the main database                      | Free and generous, but SQLite instead of Postgres, and the brief asks for Postgres + Prisma on Neon                                             |
| Status pages read Neon from Vercel with ISR             | Every cache miss wakes Neon for ≥ 5 minutes; popular pages could keep it awake all month                                                        |
| Status pages go through the Render API                  | Cold start of ~1 minute for visitors, and the API still wakes Neon                                                                              |
