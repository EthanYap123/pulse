# Deployment

Where each part of Pulse runs and how to change it. Free-tier limits are in [COSTS.md](COSTS.md). No secret values belong in this file or anywhere else in the repo.

## Status

| Part     | Production                                                                                     | Staging                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Database | Neon project `pulse`, branch `production`                                                      | Neon project `pulse`, branch `staging`                                                   |
| API      | Render `pulse-api`, https://pulse-api-0ep0.onrender.com                                        | Render `pulse-api-staging`, https://pulse-api-staging-fkbo.onrender.com                  |
| Web      | Vercel `pulse`, https://pulse-eta-sage.vercel.app                                              | Vercel preview deployments (one per PR)                                                  |
| Checker  | Worker `pulse-checker-production`, https://pulse-checker-production.ethanyapschool.workers.dev | Worker `pulse-checker-staging`, https://pulse-checker-staging.ethanyapschool.workers.dev |

Everything runs in Singapore where the host offers a choice. The Cloudflare Worker runs globally.

## Automatic deploys

[`deploy.yml`](../.github/workflows/deploy.yml) deploys without any manual step:

| Trigger                             | Deploys to | What                              |
| ----------------------------------- | ---------- | --------------------------------- |
| Push to `main` (every merged PR)    | staging    | Migrations, API, checker          |
| A published GitHub release          | production | Migrations, API, checker, web     |
| **Run workflow** on a branch or tag | either     | Same as above, for the chosen ref |

Each run:

1. Builds the API image for the commit and pushes `ghcr.io/ethanyap123/pulse-api:<sha>` (and `latest` for pushes to `main`). It skips the build if that tag already exists, so a release reuses the image staging ran. The image is public and contains no secrets.
2. Runs `prisma migrate deploy` against the environment's Neon branch. The previous API keeps serving during this, so a migration must work with the code that is already deployed: add columns and tables first, remove them in a later release.
3. Calls the Render deploy hook with `imgURL` set to the commit's image, then waits until `/health` reports that commit and `/health/db` reports `db: ok` and the right environment.
4. Runs `wrangler deploy --env <name> --var COMMIT:<sha>` and waits until the Worker's `/health` reports that commit.
5. Production only: builds the web app with the Vercel project's production variables and deploys it. `apps/web/vercel.json` turns off Vercel's own deploys of `main`, so production web changes only with a release. PRs still get preview deployments.

Runs for the same environment queue up; one is never cancelled halfway.

To release, create a tag and publish a release on GitHub (for example `gh release create v0.4.0 --generate-notes`).

### GitHub environments

Create the environments `staging` and `production` under **Settings > Environments**. Secret values exist only there and in the host dashboards. Requiring a reviewer on `production` is optional.

| Name                     | Kind     | Environments | Value                                                                                     |
| ------------------------ | -------- | ------------ | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL_DIRECT`    | secret   | both         | The Neon **direct** (not pooled) connection string for that branch                        |
| `RENDER_DEPLOY_HOOK_URL` | secret   | both         | Render service > **Settings > Deploy Hook**                                               |
| `CLOUDFLARE_API_TOKEN`   | secret   | both         | Cloudflare API token from the "Edit Cloudflare Workers" template, limited to this account |
| `CLOUDFLARE_ACCOUNT_ID`  | variable | both         | Cloudflare account ID                                                                     |
| `API_URL`                | variable | both         | That environment's Render URL                                                             |
| `CHECKER_URL`            | variable | both         | That environment's Worker URL                                                             |
| `VERCEL_TOKEN`           | secret   | production   | Vercel account token                                                                      |
| `VERCEL_ORG_ID`          | variable | production   | `orgId` in `.vercel/project.json` after `vercel link`                                     |
| `VERCEL_PROJECT_ID`      | variable | production   | `projectId` in the same file                                                              |
| `WEB_URL`                | variable | production   | https://pulse-eta-sage.vercel.app                                                         |

The Render services must use `ghcr.io/ethanyap123/pulse-api` as their image: Render rejects an `imgURL` whose registry or repository differs from the service's.

## API configuration

Set on each Render service, with different values per environment:

| Variable              | Value                                                                |
| --------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | The Neon **pooled** connection string for that environment's branch  |
| `JWT_SECRET`          | `openssl rand -hex 32`                                               |
| `ENCRYPTION_KEY`      | `openssl rand -hex 32`. Changing it makes stored secrets unreadable. |
| `NODE_ENV`            | `production`                                                         |
| `APP_VERSION`         | `production` or `staging`                                            |
| `CHECKER_URL`         | That environment's checker Worker URL                                |
| `CHECKER_HMAC_SECRET` | `openssl rand -hex 24`. Must match the checker's.                    |

Render's health check path is `/health` on both services. When creating a service, select Free by hand: Render defaults to a paid instance type.

### Checking a change took effect

If a new deploy fails to start, Render keeps serving the previous instance, so a service can look healthy while running old settings. After changing configuration, check the version it reports:

```bash
curl https://pulse-api-0ep0.onrender.com/health/db
```

Production must answer `"version":"production"` and `"db":"ok"`. A free instance can take about a minute to wake up.

## Checker

[`wrangler.toml`](../apps/checker/wrangler.toml) defines the `staging` and `production` environments. Each is its own Worker with its own Durable Objects, cron trigger and secrets:

Deploys normally come from the workflow above. By hand:

```bash
cd apps/checker
npx wrangler deploy --env staging
```

Secrets are set once per environment with `npx wrangler secret put <NAME> --env <name>` (or `wrangler secret bulk`):

| Secret                | Value                                                            |
| --------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`        | The same pooled Neon connection string as that environment's API |
| `ENCRYPTION_KEY`      | The same value as that environment's API                         |
| `CHECKER_HMAC_SECRET` | The same value as that environment's API                         |

`GET /health` on the Worker reports which environment it is.

## Web

The Vercel project builds `apps/web`. Next.js bakes the rewrites in at build time, so the URLs are build-time variables and a change needs a redeploy:

| Variable      | Production                | Preview                |
| ------------- | ------------------------- | ---------------------- |
| `API_URL`     | Production API on Render  | Staging API on Render  |
| `CHECKER_URL` | Production checker Worker | Staging checker Worker |

Every PR gets a preview deployment, built against staging. Production deploys only from a release (see [Automatic deploys](#automatic-deploys)).

## Database migrations

Migrations run separately from the API, against the Neon **direct** (not pooled) connection string:

```bash
DATABASE_URL="<direct connection string>" pnpm --filter @pulse/api db:deploy
```

Run them on `staging` first. They only apply migrations that haven't run yet, so running them again is safe.
