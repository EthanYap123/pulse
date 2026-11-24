# Contributing

Pulse is built in phases (see the GitHub milestones). Every change goes through an issue, a branch and a pull request; nothing is committed straight to `main`.

## Setup

1. Install Node 22 (`.nvmrc`) and enable pnpm with `corepack enable` (the version is pinned in `package.json`).
2. `pnpm install`. This also installs the git hooks.
3. Follow [Run locally](README.md#run-locally) for Postgres and env files.

## Workflow

1. **Issue first.** Pick or open an issue. Phase work is labelled `phase-N` and sits in that phase's milestone.
2. **Branch from an up-to-date `main`**, one branch per issue:

   | Prefix   | For                              |
   | -------- | -------------------------------- |
   | `feat/`  | New behaviour                    |
   | `fix/`   | Bug fixes                        |
   | `docs/`  | Documentation only               |
   | `chore/` | Tooling, dependencies, refactors |
   | `ci/`    | Workflows and pipelines          |
   | `test/`  | Tests only                       |

   Example: `feat/monitor-crud`.

3. **Commit with [Conventional Commits](https://www.conventionalcommits.org/).** The `commit-msg` hook runs commitlint and rejects anything else.

   ```text
   feat(api): add monitor CRUD endpoints
   fix(checker): stop counting a timeout twice
   docs: record Neon compute budget
   ```

   Scopes are optional; use the app or package name (`api`, `checker`, `web`, `shared`) when it helps.

4. **Open a PR** using the template. Reference the issue with `Closes #N`, explain how you tested it, and update `docs/` and `CHANGELOG.md` (under `[Unreleased]`) when behaviour, limits or setup change.
5. **CI must pass.** The `CI passed` check covers lint, format, typecheck, unit, integration and E2E tests, build, the API Docker image and gitleaks.
6. **Squash-merge** and delete the branch. The PR title becomes the commit on `main`, so it must be a valid Conventional Commit too.

## Checks you can run before pushing

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # needs Postgres (docker compose up -d)
pnpm test:coverage      # unit + integration with coverage thresholds (needs Postgres)
pnpm test:e2e           # Playwright against the built stack (see below)
pnpm build
```

The `pre-commit` hook runs ESLint and Prettier on staged files only.

## E2E tests

`pnpm test:e2e` drives the real UI with Playwright (`e2e/`). It builds and starts the API, the checker Worker and the web app on their own ports (4100, 8887, 3100), and drops and recreates a local `pulse_e2e` database on every run, so it never touches dev data or a hosted environment. It needs Postgres (`docker compose up -d`) and, once, `pnpm --filter @pulse/e2e exec playwright install --only-shell chromium`.

- Checks run when a test calls `tick()` (one cron tick) or `hourlyTick()` (flush, rollups and snapshots), not on a timer.
- Monitors point at `example.com`, so a run needs internet access. Private addresses are refused by design (ARCHITECTURE.md 3.7), so there is no local target.
- To run one test: `pnpm test:e2e -- -g "outage"`. Failures leave a trace in `e2e/test-results`, and CI uploads it as `playwright-report`.

The run rebuilds `apps/web/.next` against the E2E API. Run `pnpm build` again before using `pnpm start` there.

## Coverage

CI fails if coverage drops below these (statements, branches, functions, lines):

| Package           | Minimum            | Measured over                                                                    |
| ----------------- | ------------------ | -------------------------------------------------------------------------------- |
| `packages/shared` | 80%                | everything                                                                       |
| `apps/api`        | 90% (branches 85%) | unit + integration tests; `server.ts` excluded                                   |
| `apps/checker`    | 85%                | unit + integration tests; Cloudflare-only glue (`shard.ts`, `index.ts`) excluded |
| `apps/web`        | 80%                | `src/lib` (pages and components are covered by the E2E tests)                    |

Reports are uploaded as the `coverage-unit` and `coverage-integration` artifacts on every CI run.

## Secrets

Never commit secrets. Real values live in git-ignored `.env`, `.env.local` and `.dev.vars` files, in GitHub Actions secrets, and in the Vercel, Render and Cloudflare dashboards. Each app has an example file with placeholders. gitleaks scans every PR; if it flags something real, rotate the secret first, then remove it from history.

## Free-tier budget

Pulse has to stay free. Before adding a request, a cron trigger, a database query on a hot path or a new service, check [docs/COSTS.md](docs/COSTS.md) and update it if the numbers change.
