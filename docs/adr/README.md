# Architecture decision records

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-worker-cron-instead-of-a-queue.md) | Schedule checks with a Worker cron, not Redis/BullMQ | Accepted |
| [0002](0002-data-retention-and-rollups.md) | Keep raw checks 7 days, roll up hourly and daily | Accepted |
| [0003](0003-multi-tenancy.md) | Shared database with owner-scoped rows | Accepted |
| [0004](0004-buffer-checks-in-durable-objects.md) | Buffer check results in Durable Objects, flush to Neon hourly | Accepted |

New ADRs copy the structure of an existing one: Status, Date, Context, Decision, Consequences, Alternatives considered.
