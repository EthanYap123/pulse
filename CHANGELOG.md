# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
