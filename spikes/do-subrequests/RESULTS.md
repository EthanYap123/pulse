# Spike: Durable Object subrequest budget (issue #33)

**Question.** On the Workers Free plan, a single invocation can make 50 subrequests. When the
cron Worker calls a Durable Object, does the Durable Object get its own 50, or does it share
the caller's? The checker design (5 shards x 40 checks, ADR-0004) depends on the answer.

**Method.** `src/index.ts` was deployed to Workers Free on 2026-11-01 as
`pulse-spike-subrequests`. Each probe makes sequential `fetch()` calls to `https://example.com/`
until one fails. Measured from an HTTP request and from the cron trigger (`* * * * *`).

| Run | Caller                                  | Durable Objects | Fetches attempted per object | Succeeded per object   | First error                                        |
| --- | --------------------------------------- | --------------- | ---------------------------- | ---------------------- | -------------------------------------------------- |
| 1   | Worker itself, no DO                    | -               | 60                           | **50** (Worker)        | `Too many subrequests by single Worker invocation` |
| 2   | Worker (HTTP request)                   | 3               | 60                           | **50, 50, 50**         | same, inside each DO at #51                        |
| 3   | Worker (HTTP request)                   | 5               | 45                           | **45, 45, 45, 45, 45** | none                                               |
| 4   | Worker (**cron trigger**, 12:31:47 UTC) | 3               | 60                           | **50, 50, 50**         | same, inside each DO at #51                        |

**Answer.** Each Durable Object invocation has **its own 50-subrequest budget**, whether the
caller was triggered by HTTP or by cron. Calling the object costs the caller one subrequest.
Run 2 made 150 outbound requests from one incoming request.

**Consequences.**

- The planned shape works: 5 shards x 40 checks = 200 monitors per tick, with 10 subrequests
  left in each shard for Neon writes and alerts. The global cap stays at **200**.
- More capacity later means more shards, up to the 32 Worker invocations one request may fan
  out to, not bigger shards.

The Worker was deleted after the measurements. To repeat them:

```bash
cd spikes/do-subrequests
npx wrangler deploy
curl "https://pulse-spike-subrequests.<subdomain>.workers.dev/fanout?shards=3&n=60"
npx wrangler delete
```
