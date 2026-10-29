# ADR-0001: Schedule checks with a Worker cron, not Redis/BullMQ

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Pulse needs to run an HTTP check for every active monitor every 5 minutes, all day, on free tiers with no card.

The usual Node.js answer is a job queue: BullMQ on Redis, with a long-running worker process consuming repeatable jobs. That needs two things the free stack doesn't have:

- **An always-on process.** Render's free web services spin down after 15 minutes without inbound traffic, and Render has no free background workers or cron jobs. A sleeping process runs no jobs.
- **A Redis instance.** Free hosted Redis plans exist, but they cap commands per day, and BullMQ polls Redis constantly (repeatable jobs, stalled-job checks, delayed-job timers). That would burn through a daily command quota while doing nothing useful.

Cloudflare Workers' free plan includes Cron Triggers (5 per account) that run on Cloudflare's side whether or not anyone is visiting, plus Durable Objects with SQLite storage.

## Decision

- A **Cron Trigger** (`*/5 * * * *`) on the checker Worker is the only scheduler.
- The cron Worker fans out to **5 shard Durable Objects**; each runs up to 40 checks per tick (see [ARCHITECTURE.md](../ARCHITECTURE.md#31-scheduling)).
- Work that would normally be a queued job is handled by **state the shards keep in their own SQLite**:
  - alert retries → an outbox table with `next_attempt_at`, scanned each tick;
  - hourly flush, rollups and retention → run on the tick at minute 0;
  - overlapping ticks → a `tick_started_at` guard per shard.
- No Redis, no BullMQ, no always-on process.

## Consequences

**Good**

- $0 and no idle cost: nothing runs between ticks.
- Checks keep running when the API on Render is asleep or down.
- One less service to deploy, secure and monitor.
- Durable Objects give strongly consistent, single-threaded state per shard, which also solves duplicate incident detection (ADR-0004).

**Bad**

- **Granularity is 1 minute at best, 5 minutes by design.** Users can't choose per-monitor intervals in v1.
- **No queue features for free:** priorities, rate-limited queues, dashboards, delayed jobs. The outbox covers the one case we need (alert retries).
- **Cron reliability is Cloudflare's.** A missed tick is a 5-minute gap. A future watchdog could alert if the last flush is more than 2 hours old.
- **Hard per-invocation limits** (50 subrequests, 6 open connections) force sharding and a global cap of 200 monitors.
- Local development needs `wrangler dev --test-scheduled` to trigger ticks by hand.

## Alternatives considered

| Option | Why not |
| --- | --- |
| BullMQ + free hosted Redis + worker on Render | Render worker sleeps; Redis command quotas; more moving parts |
| GitHub Actions `schedule` | Minimum 5 min but often delayed by 10+ minutes under load; not meant for production scheduling; no state |
| Vercel Cron Jobs | Hobby crons are limited and imprecise; functions have short time limits; would still need state somewhere |
| `pg_cron` in Neon | Would keep Neon awake every 5 minutes, which breaks the compute budget (see ADR-0004) |
| Cloudflare Queues | Not needed: Durable Object state covers retries, and it adds another product to learn and budget for |
