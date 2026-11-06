# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Hosting accounts confirmed on free plans with no card: Render, Vercel and Neon (production and staging branches, Singapore, Postgres 17). Free-tier limits re-checked in `docs/COSTS.md`.
- Hourly and daily rollups with retention: raw checks kept 7 days, hourly rollups 30, daily rollups and resolved incidents 400. The 7- and 30-day charts and the status page bars now read rollups, so 30-day charts and 90-day bars show their full range. Added `GET /v1/monitors/:id/uptime`.
- Public status pages at `/status/<slug>`: overall status, 90-day uptime bars and recent incidents, served from checker snapshots so they keep working when the API and Postgres are down. Owners can make a page private or hide individual monitors.
- Discord alerts: alert channels per project, outage and recovery messages sent by the checker with retries, cooldown for flapping monitors, and channels turned off when Discord rejects the webhook.
- Incidents: opened and resolved by the checker in real time, one open per monitor, resolved on pause, listed in the API and dashboard with notes.
- Coverage thresholds enforced in CI: shared 80%, web lib 80%, API 90%, checker 85%, with reports as artifacts.
- Dashboard: sign-up/login, projects, monitors with live status, latency chart (24h/7d/30d), light/dark/match-device theme, waking-API banner.
- Checker: cron-driven HTTP checks in 5 Durable Object shards, monitor state machine, hourly flush to Postgres, config sync and live status from the API, and a check-history endpoint.
- Measured Durable Object subrequest budget (own 50 per object, from cron too); confirms the 200-monitor cap.
- Projects and monitors API with per-user and global caps, SSRF-safe URL validation, encrypted header values and tenant isolation.
- Accounts: sign-up, login, rotating refresh tokens with reuse detection, logout and `/v1/me`.
- Database schema and first migration for users, refresh tokens, projects, monitors and check results.
- Contribution guide, PR and issue templates, and a recommended branch-protection ruleset for `main`.
- CI on every PR: lint, format, typecheck, unit and integration tests, build, API Docker image build and smoke test, gitleaks.
- ESLint 10, Prettier, Husky pre-commit (lint-staged) and commit-msg (commitlint) hooks.
- Docker Compose Postgres 17 for local development and example env files for every app.
- Monorepo scaffold: pnpm workspaces, Turborepo, `apps/api`, `apps/checker`, `apps/web`, `packages/shared`.
- Four ADRs (cron vs queue, retention and rollups, multi-tenancy, Durable Object buffering) and design links, key decisions and trade-offs in the README.
- `docs/ERD.md` and `docs/API.md` covering every table, endpoint and user story.
- `docs/ARCHITECTURE.md` with system diagram, check scheduling, incident state machine, duplicate-alert prevention and the status-page data path.
- `docs/PRD.md` with personas, user stories, acceptance criteria and non-functional requirements.
- `docs/COSTS.md` with free-tier limits, Neon compute/storage budgets and resulting caps.
- Repository skeleton: README, MIT license, `.gitignore`, changelog.

### Fixed

- Signed-out visitors no longer wake the API: the landing and login pages only check for a session if this browser has signed in.
- Local Compose Postgres is published on port 5434 (override with `PULSE_DB_PORT`) to avoid clashing with a native install.
- `next dev` no longer leaves changes in git (`next-env.d.ts` untracked, Next's `agentRules` off).
- `/health` no longer queries the database (new `/health/db` does); web builds receive `API_URL`/`CHECKER_URL` under Turborepo strict env mode; Prisma config no longer falls back to a placeholder database URL.
