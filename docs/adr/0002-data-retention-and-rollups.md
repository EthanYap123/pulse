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

The job runs from the checker's hourly tick (minute 0), after the buffer flush:

1. Upsert hourly rollups for the **last 2 complete hours** (so a late flush is caught next hour).
2. Upsert daily rollups for **today and yesterday** (UTC), computed from hourly rollups.
3. Delete expired rows by time range in batches of 10,000 (to keep each statement short).
4. Rebuild status-page snapshots from the daily table.

Every step is an `INSERT ... ON CONFLICT DO UPDATE` or a range `DELETE`, so running it twice, or skipping an hour, gives the same result. p95 is computed with `percentile_cont(0.95)` over raw rows for hourly rollups; the daily p95 is the max of the hourly p95s (an upper bound, documented in the UI tooltip) to avoid keeping raw rows longer.

## Consequences

**Good**

- Storage stays under ~100 MB at the global cap (see [COSTS.md](../COSTS.md#storage-budget-1-gb)), leaving room for staging and growth.
- Status pages and long-range charts read small tables, so queries stay fast and cheap in Neon compute.
- Retention is fixed in code, so tests can assert it.

**Bad**

- No drill-down into individual checks older than 7 days.
- Daily p95 is approximate.
- If the hourly job doesn't run for more than 7 days (e.g. Neon out of compute for a week), raw rows needed for some hourly rollups could be deleted before they're rolled up. Mitigation: the retention delete only removes raw rows for hours that already have an hourly rollup.
- Rollups depend on the checker's tick; a Cloudflare outage delays them.

## Alternatives considered

| Option                                              | Why not                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Keep all raw checks                                 | ~21M rows/year, over 1 GB within months                                                                                |
| TimescaleDB continuous aggregates                   | Not available on Neon                                                                                                  |
| Partitioned `check_results` by day, drop partitions | Cleaner deletes, but Prisma doesn't manage partitions and the volume doesn't need it yet. Revisit if deletes get slow. |
| Store only daily rollups                            | Loses the latency charts the dashboard needs                                                                           |
| Run the rollup with `pg_cron`                       | Would wake Neon on its own schedule; better to piggyback on the flush that already wakes it                            |
