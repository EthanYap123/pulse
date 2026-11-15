# Performance

How the API is load-tested and the latest results. Target (PRD NFR-07): **API p95 under 300 ms when warm.** A cold start (~1 min on Render Free) is a separate, accepted state that the dashboard shows as "waking up".

## Load test

[`load/dashboard.js`](../load/dashboard.js) is a [k6](https://grafana.com/docs/k6/latest/) script that loads the dashboard's pages the way a signed-in user does:

1. **Setup:** waits for `/health` (up to 2 minutes, to get past a cold start), signs up a throwaway account (`k6-<timestamp>@example.com`, random password that is never stored), and creates one project with three monitors.
2. **Warm-up:** 1 user for 30 s. Not counted in the thresholds.
3. **Load:** ramps to 10 users, holds for 2 minutes, ramps down. Each user loads the projects page, a project page (project, monitors, incidents) and a monitor page (details, 24-hour chart, 90-day uptime, then the 7-day chart), with 1-2 s of think time between pages.
4. **Teardown:** deletes the project. The account stays, because there is no account deletion yet.

Thresholds: p95 under 300 ms overall and for each endpoint, and under 1% failed requests, all for the load phase only. k6 exits non-zero when one is crossed.

Run it against staging or a local API, **never production**:

```bash
k6 run -e BASE_URL=https://pulse-api-staging-fkbo.onrender.com load/dashboard.js
```

`VUS` (default 10) and `DURATION` (default `2m`) can be overridden with `-e`. Install k6 with `winget install GrafanaLabs.k6`, `brew install k6` or the [other options](https://grafana.com/docs/k6/latest/set-up/install-k6/).

The run keeps the staging Neon branch awake for its length plus the 5-minute idle timeout, about 0.04 CU-hours.

## Results

### 2026-11-15, staging (`e68b182`), from Singapore

10 users, 1,719 requests in the load phase, **0 failed**. k6 v2.4.0, run from a laptop in Singapore against Render and Neon in Singapore.

| Endpoint                         | median | p95    | p99    | Within 300 ms? |
| -------------------------------- | ------ | ------ | ------ | -------------- |
| `GET /v1/me`                     | 65 ms  | 142 ms | 255 ms | yes            |
| `GET /v1/projects`               | 59 ms  | 137 ms | 258 ms | yes            |
| `GET /v1/projects/:id`           | 63 ms  | 143 ms | 250 ms | yes            |
| `GET /v1/projects/:id/incidents` | 63 ms  | 128 ms | 253 ms | yes            |
| `GET /v1/monitors/:id/checks`    | 60 ms  | 131 ms | 276 ms | yes            |
| `GET /v1/monitors/:id/uptime`    | 60 ms  | 110 ms | 199 ms | yes            |
| `GET /v1/projects/:id/monitors`  | 333 ms | 551 ms | 857 ms | **no**         |
| `GET /v1/monitors/:id`           | 316 ms | 539 ms | 921 ms | **no**         |
| **All (load phase)**             | 67 ms  | 348 ms | 562 ms | **no**         |

The two slow endpoints are the only ones that ask the checker for live status (`POST /internal/v1/live` on the Worker, which asks the shard Durable Objects). That call adds about 260 ms. Tracked in [#73](https://github.com/EthanYap123/pulse/issues/73), with likely causes.

Everything that only reads Postgres is well within budget, including the chart and uptime queries that read rollups.
