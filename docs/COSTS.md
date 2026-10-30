# Costs and free-tier limits

Pulse must cost **$0** to build and run, on free tiers that need **no credit card**. This file records the limits each service sets, when they were checked, and the design choice each limit drives.

Limits change. Re-check this file against the linked pages before each phase that adds a service, and update the "Checked" date.

**Last checked: 2026-10-29**

## Summary

| Service                              | Used for                                  | Plan                     | Card needed?                                        | Status                                   |
| ------------------------------------ | ----------------------------------------- | ------------------------ | --------------------------------------------------- | ---------------------------------------- |
| Cloudflare Workers + Durable Objects | Checker, live status, Telegram webhook    | Workers Free             | No                                                  | OK                                       |
| Neon                                 | Postgres (source of truth)                | Free                     | No (pricing page: "no credit card required")        | OK, compute hours are the tightest limit |
| Vercel                               | Next.js dashboard and public status pages | Hobby                    | No                                                  | OK, non-commercial use only              |
| Render                               | Fastify API (Docker image)                | Free web service         | **Unclear**, see [Risks](#risks-and-open-questions) | Confirm before Phase 4                   |
| Sentry                               | Error tracking for API and web            | Developer (free)         | No                                                  | OK                                       |
| Discord                              | Alerts via channel webhooks               | Free                     | No                                                  | OK                                       |
| Telegram                             | Alerts via Bot API                        | Free                     | No                                                  | OK                                       |
| GitHub Actions                       | CI/CD                                     | Free for public repos    | No                                                  | OK                                       |
| GitHub Container Registry            | API Docker image                          | Free for public packages | No                                                  | OK                                       |

## Cloudflare Workers (Free)

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

| Limit                                          | Free plan                                        | How Pulse stays inside it                                                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests                                       | 100,000 / day                                    | Checker uses ~1,700/day (288 ticks x 1 Worker + 5 shard objects). Public status reads are cached by Vercel ISR for 60 s, so at most 1,440 reads per status page per day.                                                                 |
| CPU time per Worker invocation (HTTP and Cron) | **10 ms**                                        | The cron Worker only wakes the shard Durable Objects; it does no check work itself.                                                                                                                                                      |
| Cron wall-clock per invocation                 | 15 minutes                                       | A tick finishes in well under a minute (8 s check timeout, see below).                                                                                                                                                                   |
| Subrequests per invocation                     | **50** (external and Cloudflare services)        | Each shard runs at most **40 checks per tick**, leaving 10 subrequests for Neon writes and alerts. Extra alerts go into an outbox and are sent on the next tick.                                                                         |
| Simultaneous open connections                  | 6 per invocation                                 | Checks run 6 at a time. 40 checks = 7 waves.                                                                                                                                                                                             |
| Cron Triggers                                  | 5 per account                                    | 2 used: production (`*/5 * * * *`) and staging. The hourly flush runs inside the 5-minute tick at minute 0, so it needs no trigger of its own.                                                                                           |
| Memory                                         | 128 MB                                           | Response bodies are never read; only status code and timing are kept.                                                                                                                                                                    |
| Environment variables                          | 64 per Worker, 5 KB each                         | ~8 needed.                                                                                                                                                                                                                               |
| Service binding / DO calls                     | 32 Worker invocations per request                | Cron Worker fans out to at most 5 shard objects.                                                                                                                                                                                         |
| Durable Objects                                | Free plan: SQLite-backed objects only            | Shards use the SQLite storage API.                                                                                                                                                                                                       |
| DO requests                                    | 100,000 / day                                    | Same budget as Worker requests above.                                                                                                                                                                                                    |
| DO duration                                    | **13,000 GB-s / day** (128 MB object = 0.125 GB) | Typical tick ~5 s per shard: 5 x 288 x 0.625 = **900 GB-s/day**. Worst case (every site timing out at 8 s, 7 waves = 56 s): 5 x 288 x 7 = **10,080 GB-s/day**, still under the cap. This is why the timeout is 8 s and shards stay at 5. |
| DO CPU per invocation                          | 30 s (default)                                   | Far more room than a plain Worker's 10 ms, which is one reason checks run inside the objects.                                                                                                                                            |
| DO SQLite rows written                         | **100,000 / day**                                | Results are buffered as **one row per shard per tick** (a JSON array), not one row per check: ~1,440 rows/day plus ~1,440 state rows.                                                                                                    |
| DO SQLite rows read                            | 5,000,000 / day                                  | Negligible.                                                                                                                                                                                                                              |
| DO storage                                     | 5 GB total, 1 GB per object                      | Buffers are cleared every hour after the flush to Neon.                                                                                                                                                                                  |

**To verify in the Phase 2 spike:** the docs do not say whether a Durable Object called from the cron Worker gets its own 50-subrequest budget or shares the caller's. The design assumes its own budget (Durable Objects are separate invocations). If it turns out to be shared, the global monitor cap drops to 40 and this file gets updated.

## Neon Postgres (Free)

Source: [Neon plans](https://neon.com/docs/introduction/plans), [Neon pricing](https://neon.com/pricing)

| Limit                  | Free plan                                                      | How Pulse stays inside it                                            |
| ---------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Compute                | **100 CU-hours per project per month**, shared by all branches | See the budget below. This is the tightest limit in the whole stack. |
| Compute size           | 0.25 CU minimum (autoscaling up to 2 CU)                       | Pin to 0.25 CU; Pulse queries are small.                             |
| Scale to zero          | Suspends after **5 min** idle, cannot be disabled              | Design so Neon is idle most of the time.                             |
| Running out of compute | Compute suspended until the next month (data kept)             | Budget below leaves ~50% headroom.                                   |
| Storage                | 1 GB per project (20 GB across projects)                       | Retention and rollups, see below.                                    |
| Branches               | 10 per project                                                 | 2 used: `main` (production) and `staging`.                           |
| Egress                 | 5 GB per project per month                                     | Small JSON queries; well under.                                      |
| Point-in-time restore  | 6-hour window                                                  | Documented in the Phase 4 rollback procedure.                        |

### Why the checker cannot write to Neon on every tick

At 0.25 CU, Neon awake for a whole month is `0.25 x 730 h = 182.5 CU-hours`, almost **double** the free allowance. A checker that writes every 5 minutes never lets Neon reach its 5-minute idle suspend, so it would run out of compute around day 16 of every month.

So the checker **buffers results in Durable Objects** and wakes Neon only:

1. once an hour, to flush the buffer, run rollups and refresh status page snapshots, and
2. when a monitor changes state (an incident opens or resolves), which is rare.

### Compute budget (production + staging share one project)

| Source                                       | Wakes                 | Awake time each                  | CU-hours / month |
| -------------------------------------------- | --------------------- | -------------------------------- | ---------------- |
| Production hourly flush                      | 24 / day              | ~5 min idle timeout + ~10 s work | ~15.5            |
| Staging hourly flush                         | 24 / day              | same                             | ~15.5            |
| Incident open/resolve writes                 | ~2 / day (estimate)   | ~5 min                           | ~1.3             |
| Dashboard use (logged-in users, via the API) | ~2 h / day (estimate) |                                  | ~15              |
| CI migrations and deploys                    | ~20 / month           | ~5 min                           | ~0.4             |
| **Total**                                    |                       |                                  | **~48 of 100**   |

The staging checker can be paused (its cron trigger removed) when staging isn't being tested, which frees ~15 CU-hours. Public status pages **never** wake Neon: they are served from snapshots held in the Worker (see [ARCHITECTURE.md](ARCHITECTURE.md)).

### Storage budget (1 GB)

With the global cap of 200 monitors checked every 5 minutes (57,600 checks/day):

| Table                  | Kept for | Rows     | Approx size (incl. indexes) |
| ---------------------- | -------- | -------- | --------------------------- |
| `check_results` (raw)  | 7 days   | ~403,000 | ~45 MB                      |
| `check_rollups_hourly` | 30 days  | ~144,000 | ~15 MB                      |
| `check_rollups_daily`  | 400 days | ~80,000  | ~8 MB                       |
| Everything else        |          | small    | < 10 MB                     |
| **Total**              |          |          | **< 100 MB**                |

Retention is enforced by the hourly job. Details in [ADR-0002](adr/0002-data-retention-and-rollups.md).

## Vercel (Hobby)

Source: [Vercel limits](https://vercel.com/docs/limits), [Fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines)

| Limit                | Hobby                                                        | Notes                                                  |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| Use                  | **Non-commercial personal use only**                         | Pulse is a portfolio project with no payments or ads.  |
| Fast Data Transfer   | 100 GB / month                                               | Status pages are small.                                |
| Function invocations | 1,000,000 / month                                            | ISR keeps status pages mostly static.                  |
| Active CPU           | 4 hours / month                                              | Server components only fetch and render.               |
| Fast Origin Transfer | 10 GB / month                                                |                                                        |
| Provisioned memory   | 360 GB-hours / month                                         |                                                        |
| Image optimisation   | 5,000 transformations / month                                | Not used (SVG/CSS only).                               |
| Deployments          | 100 / day                                                    | Preview deploys per PR are fine.                       |
| Runtime logs         | Kept 1 hour                                                  | Errors go to Sentry instead.                           |
| Git repos            | Hobby can't connect repos owned by a GitHub **organisation** | The repo is under a personal account, so this is fine. |

## Render (Free web service)

Source: [Render free instances](https://render.com/docs/free), [Deploying an image](https://render.com/docs/deploying-an-image)

| Limit                     | Free                                                                                       | How Pulse stays inside it                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Instance hours            | 750 per workspace per month; spun-down services use none                                   | Production and staging API both spin down when idle. Only dashboard use keeps them up.     |
| Spin-down                 | After **15 min** with no inbound traffic                                                   | Accepted. Public status pages don't use the API, so only logged-in users see a cold start. |
| Spin-up                   | About **1 minute**                                                                         | Dashboard shows a "waking the API" state.                                                  |
| Disk                      | No persistent disk                                                                         | API is stateless.                                                                          |
| Outbound ports            | 25, 465, 587 blocked                                                                       | No email; alerts use HTTPS (Discord, Telegram).                                            |
| Bandwidth / build minutes | Workspace allowance; without a card, services are **suspended** (not billed) when exceeded | Images are built in GitHub Actions, not on Render, so Render build minutes stay near zero. |
| Prebuilt images           | Image-backed services deploy via a **deploy hook** (no auto-redeploy on new tag)           | CD calls the deploy hook with the new GHCR tag.                                            |
| Rollback                  | To the two most recent previous deploys                                                    | Documented in Phase 4.                                                                     |

## Sentry (Developer, free)

Source: [Sentry pricing](https://sentry.io/pricing/)

| Limit           | Developer | Notes                                 |
| --------------- | --------- | ------------------------------------- |
| Errors          | 5,000     | Errors only, with sampling if needed. |
| Spans (tracing) | 5M        | Tracing sample rate 0.1.              |
| Session replays | 50        | Disabled.                             |
| Users           | 1         | Solo project.                         |
| Retention       | 30 days   |                                       |

## Discord webhooks

Source: [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits)

- No fixed webhook rate is published; limits are **per webhook** and returned in `X-RateLimit-*` headers. A 429 carries `Retry-After`.
- 10,000 invalid requests (401/403/429) per 10 minutes gets an IP temporarily banned; Cloudflare Worker IPs are shared, so Pulse must respect 429s and never retry blindly.
- A **404** means the webhook was deleted: Pulse disables that channel and stops sending.

## Telegram Bot API

Source: [Bots FAQ](https://core.telegram.org/bots/faq)

- Free. Limits: about **1 message per second per chat**, **20 messages per minute per group**, about **30 messages per second** overall.
- Pulse sends at most one message per incident event per chat, so these limits are far away. Paid broadcasts are not used.

## GitHub Actions and Container Registry

Sources: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages)

- Standard GitHub-hosted runners are **free for public repositories**.
- GitHub Packages is **free for public packages**; Container registry storage and bandwidth are currently free.
- The repo and the `ghcr.io/ethanyap123/pulse-api` image are public.

## Caps that follow from these limits

| Cap                        | Value               | Driven by                                     |
| -------------------------- | ------------------- | --------------------------------------------- |
| Check interval             | 5 minutes (fixed)   | Cron granularity, DO duration and Neon budget |
| Check timeout              | 8 seconds           | DO duration worst case                        |
| Monitors per user          | 10                  | Fair share of the global cap                  |
| Projects per user          | 3                   |                                               |
| Alert channels per project | 5                   | Subrequest budget per tick                    |
| Global active monitors     | 200 (5 shards x 40) | Worker subrequests per invocation             |
| Raw check retention        | 7 days              | Neon storage                                  |

When the global cap is reached, new monitors are refused with a clear message instead of degrading everyone's checks.

## Risks and open questions

1. **Render may ask for a card.** Render's docs only mention a payment method for overages, but community reports say some accounts are asked for card verification at sign-up (with a reversed $1 charge). **Stop and ask before Phase 4** if Render asks for one. Fallbacks that need no card: run the API as Next.js route handlers on Vercel (no Docker deploy target), or keep the Docker image as a CI artifact only and document it.
2. **Durable Object subrequest budget** when called from a cron Worker is not documented. Measure in the Phase 2 spike.
3. **Durable Object duration** in the worst case is ~78% of the daily cap. If real numbers are higher, lower the timeout or the shard count.
4. **Neon compute estimate for dashboard use** is a guess. Watch the Neon usage page weekly after launch.
