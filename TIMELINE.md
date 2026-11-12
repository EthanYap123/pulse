# Pulse Timeline

Last updated: 2026-11-11

Each phase is a GitHub milestone. v1.0.0 is tagged at the end of Phase 6.

## ✅ Phase 0: Requirements & Design

PRD, architecture, ERD, API contract, costs and ADRs.

- [x] Part 1: Free-tier limits and cost plan (#1)
- [x] Part 2: Product requirements (#2)
- [x] Part 3: Architecture, incident detection and alert de-duplication (#3)
- [x] Part 4: ERD and API contract (#4)
- [x] Part 5: Architecture decision records (#5)

## ✅ Phase 1: Repo setup & CI

Monorepo, local Postgres, linting and hooks, CI pipeline, contribution docs.

- [x] Part 1: Monorepo scaffold with pnpm workspaces and Turborepo (#12)
- [x] Part 2: Docker Compose Postgres and example env files (#13)
- [x] Part 3: Lint, format, typecheck, Husky and commitlint (#14)
- [x] Part 4: GitHub Actions pipeline on every PR (#15)
- [x] Part 5: PR and issue templates, CONTRIBUTING and branch protection (#16)

## ✅ Phase 2: Core MVP

Auth, projects and monitors CRUD, real checks, dashboard with latency chart, coverage.

- [x] Part 1: Prisma schema and first migration (#30)
- [x] Part 2: Sign-up, login, token refresh and logout (#31)
- [x] Part 3: Projects and monitors CRUD (#32)
- [x] Part 4: Checker running HTTP checks on the cron (#33, #34)
- [x] Part 5: Dashboard with monitor status and latency chart (#35)
- [x] Part 6: Coverage thresholds in CI (#36)

## ✅ Phase 3: Incidents & alerting

Incidents in Postgres, Discord alerts, public status pages, rollups and retention.

- [x] Part 1: Incidents when monitors go down and recover (#45)
- [x] Part 2: Discord alerts with de-duplication and cooldown (#46; Telegram dropped)
- [x] Part 3: Public status page with 90-day uptime bars (#47, #52)
- [x] Part 4: Hourly rollups and data retention (#48)

## ✅ Phase 4: Deployment & CD

Pulse online on free tiers, with automatic deploys to staging and production and a tested rollback.

- [x] Part 1: Hosting accounts and free-tier checks (#55)
- [x] Part 2: Deploy the database and API (#56)
- [x] Part 3: Deploy the checker and web app (#57)
- [x] Part 4: Automatic deploys from GitHub Actions (#58)
- [x] Part 5: Rollback procedure, first production release and live verification (#59, #66, #67)

## ⬜ Phase 5: Hardening & testing

Security hardening, load testing and end-to-end tests.

- [ ] Part 1: SSRF hardening with DNS checks for monitor URLs
- [ ] Part 2: k6 load test of the warm API (p95 under 300 ms)
- [ ] Part 3: Playwright E2E for sign-up to live status page

## ⬜ Phase 6: v1.0 release

Final polish, docs and the v1.0.0 tag.

- [ ] Part 1: Polish and docs review
- [ ] Part 2: Tag and release v1.0.0

## ⬜ Phase 7: Post-launch

Run Pulse on real projects and check it against the success metrics.

- [ ] Part 1: 30 days monitoring real projects with no missed outage or duplicate alert
- [ ] Part 2: Review Neon usage against the 60 CU-hour target
