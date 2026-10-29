# Pulse

Uptime monitoring with public status pages. Create monitors for URLs and API endpoints, get alerted on Discord or Telegram when they go down, and share a status page with uptime history.

> Work in progress. Requirements and design live in [`docs/`](docs/); see [`CHANGELOG.md`](CHANGELOG.md) for progress.

## Planned stack

- `apps/web`: Next.js dashboard and public status pages (Vercel)
- `apps/api`: Fastify + Prisma REST API (Docker image on Render)
- `apps/checker`: Cloudflare Worker on a cron trigger that runs the checks
- `packages/shared`: types, zod schemas and incident logic
- Postgres on Neon; alerts through Discord webhooks and a Telegram bot

Everything runs on free tiers. See [`docs/COSTS.md`](docs/COSTS.md) once it lands.

## License

[MIT](LICENSE)
