# Pulse

Uptime monitoring with public status pages. Create monitors for URLs and API endpoints, get alerted on Discord or Telegram when they go down, and share a status page with uptime history.

> Work in progress. Requirements and design live in [`docs/`](docs/); see [`CHANGELOG.md`](CHANGELOG.md) for progress.

## Planned stack

- `apps/web`: Next.js dashboard and public status pages (Vercel)
- `apps/api`: Fastify + Prisma REST API (Docker image on Render)
- `apps/checker`: Cloudflare Worker on a cron trigger that runs the checks
- `packages/shared`: types, zod schemas and incident logic
- Postgres on Neon; alerts through Discord webhooks and a Telegram bot

Everything runs on free tiers with no card. See [`docs/COSTS.md`](docs/COSTS.md).

## Run locally

Needs Node 22 (see `.nvmrc`), pnpm 10 (`corepack enable`), and Docker for Postgres.

```bash
pnpm install
docker compose up -d
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/checker/.dev.vars.example apps/checker/.dev.vars
pnpm dev
```

| App     | URL                                                                              |
| ------- | -------------------------------------------------------------------------------- |
| Web     | http://localhost:3000                                                            |
| API     | http://localhost:4000/health                                                     |
| Checker | http://localhost:8787/health (trigger a tick: http://localhost:8787/__scheduled) |

Other commands: `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm test:integration` (needs Postgres; uses `TEST_DATABASE_URL`, falling back to `DATABASE_URL`).

## Design docs

- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model (ERD)](docs/ERD.md)
- [API contract](docs/API.md)
- [Costs and free-tier limits](docs/COSTS.md)
- [Architecture decision records](docs/adr/README.md)

## Key decisions

- **Cron, not a queue.** A Cloudflare Worker cron runs every 5 minutes; there is no Redis or always-on worker ([ADR-0001](docs/adr/0001-worker-cron-instead-of-a-queue.md)).
- **Neon sleeps most of the time.** Writing every check would keep Postgres awake all month and use ~182 of the 100 free compute hours, so results are buffered in Durable Objects and flushed hourly ([ADR-0004](docs/adr/0004-buffer-checks-in-durable-objects.md)).
- **Status pages never wait on a cold start.** They read hourly snapshots plus live state from the Worker, not the API or the database.
- **Bounded storage.** Raw checks 7 days, hourly rollups 30 days, daily rollups 400 days ([ADR-0002](docs/adr/0002-data-retention-and-rollups.md)).

## Free-tier trade-offs

| Limit                                 | Trade-off                                                                |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Worker: 50 subrequests per invocation | 5 shards x 40 checks = 200 monitors max; 10 per user                     |
| Neon: 100 CU-hours/month              | History in Postgres lags up to 1 hour; live status comes from the Worker |
| Neon: 1 GB storage                    | Old raw checks are rolled up and deleted                                 |
| Render: sleeps after 15 min idle      | Dashboard's first load can take ~1 minute; status pages are unaffected   |
| Cron granularity                      | Fixed 5-minute interval; outages detected in 10-15 minutes               |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch, commit and PR workflow, and [docs/BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md) for the rules on `main`.

## License

[MIT](LICENSE)
