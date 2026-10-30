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
5. **CI must pass.** The `CI passed` check covers lint, format, typecheck, unit and integration tests, build, the API Docker image and gitleaks.
6. **Squash-merge** and delete the branch. The PR title becomes the commit on `main`, so it must be a valid Conventional Commit too.

## Checks you can run before pushing

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration   # needs Postgres (docker compose up -d)
pnpm build
```

The `pre-commit` hook runs ESLint and Prettier on staged files only.

## Secrets

Never commit secrets. Real values live in git-ignored `.env`, `.env.local` and `.dev.vars` files, in GitHub Actions secrets, and in the Vercel, Render and Cloudflare dashboards. Each app has an example file with placeholders. gitleaks scans every PR; if it flags something real, rotate the secret first, then remove it from history.

## Free-tier budget

Pulse has to stay free. Before adding a request, a cron trigger, a database query on a hot path or a new service, check [docs/COSTS.md](docs/COSTS.md) and update it if the numbers change.
