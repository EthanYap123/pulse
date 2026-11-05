# ADR-0002: Keep raw checks 7 days and roll them up hourly and daily

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

At the global cap of 200 monitors checked every 5 minutes, Pulse produces **57,600 checks per day** (~21 million per year). Neon's free plan allows **1 GB** of storage per project, shared by the production and staging branches.

The product needs:

- a 24-hour latency chart with every check (US-07);
- 7- and 30-day latency charts (hourly resolution is plenty);
- 90 daily uptime bars per monitor on the status page (US-14);
- incident history.

Nobody needs individual checks from last month.

## Decision

Three tiers, each with a fixed retention:

| Table                  | Grain                                                 | Kept         | Used by                                  |
| ---------------------- | ----------------------------------------------------- | ------------ | ---------------------------------------- |
| `check_results`        | one row per check                                     | **7 days**   | 24 h chart; source for rollups           |
| `check_rollups_hourly` | monitor x hour: checks, failures, avg/p95/max latency | **30 days**  | 7 d / 30 d charts                        |
| `check_rollups_daily`  | monitor x UTC day: checks, failures, avg/p95 latency  | **400 days** | 90-day bars, uptime %, yearly view later |

Resolved incidents and their alert deliveries are kept **400 days**.

The job runs from the checker's hourly tick (minute 0), after the buffer flush, in the `Snapshots` Durable Object, which has its own subrequest budget:

1. Upsert hourly rollups for **every complete hour whose raw count differs from its rollup**. A fixed window would miss results flushed later than it allows; comparing counts catches them however late, and a repeat run touches nothing.
2. Upsert daily rollups from the hourly ones, from **yesterday (UTC) or the oldest hour that changed**, never past 29 days. Recomputing a day whose hourly rows have started to expire would overwrite a correct figure with a smaller one.
3. Delete expired rows, only if the rollups succeeded. Raw checks go **a whole hour at a time and only where that hour has a rollup**, because deleting part of an hour would make its count differ and step 1 would rebuild the rollup from the remainder. At most 24 hours go per run, which keeps catching up after an outage cheap, and at the normal rate each run deletes one hour.
4. Rebuild status-page snapshots from the daily table, even if the steps above failed.

Running it twice, or skipping an hour, gives the same result. p95 is computed with `percentile_cont(0.95)` over raw rows for hourly rollups; the daily p95 is the max of the hourly p95s (an upper bound) to avoid keeping raw rows longer. Latency figures only count successful checks, so an hour where every check failed has no latency.

## Consequences

**Good**

- Storage stays under ~100 MB at the global cap (see [COSTS.md](../COSTS.md#storage-budget-1-gb)), leaving room for staging and growth.
- Status pages and long-range charts read small tables, so queries stay fast and cheap in Neon compute.
- Retention is fixed in code, so tests can assert it.

**Bad**

- No drill-down into individual checks older than 7 days.
- Daily p95 is approximate.
- If the hourly job doesn't run for more than 7 days (e.g. Neon out of compute for a week), raw rows wait past their retention. They are rolled up before any are deleted, so nothing is lost, but the first runs afterwards have more to do.
- Rollups depend on the checker's tick; a Cloudflare outage delays them.
- Charts and bars built from rollups don't include the hour in progress.

## Alternatives considered

| Option                                              | Why not                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Keep all raw checks                                 | ~21M rows/year, over 1 GB within months                                                                                |
| TimescaleDB continuous aggregates                   | Not available on Neon                                                                                                  |
| Partitioned `check_results` by day, drop partitions | Cleaner deletes, but Prisma doesn't manage partitions and the volume doesn't need it yet. Revisit if deletes get slow. |
| Store only daily rollups                            | Loses the latency charts the dashboard needs                                                                           |
| Run the rollup with `pg_cron`                       | Would wake Neon on its own schedule; better to piggyback on the flush that already wakes it                            |
