# Deployment

Where each part of Pulse runs and how to change it. Free-tier limits are in [COSTS.md](COSTS.md). No secret values belong in this file or anywhere else in the repo.

## Status

| Part     | Production                                                    | Staging                                                                 |
| -------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Database | Neon project `pulse`, branch `production`                     | Neon project `pulse`, branch `staging`                                  |
| API      | Render `pulse-api`, https://pulse-api-0ep0.onrender.com       | Render `pulse-api-staging`, https://pulse-api-staging-fkbo.onrender.com |
| Web      | Vercel `pulse`, https://pulse-eta-sage.vercel.app (not wired) | Vercel preview deployments (not wired)                                  |
| Checker  | Not deployed yet                                              | Not deployed yet                                                        |

Everything runs in Singapore where the host offers a choice. The Cloudflare Worker runs globally.

## API image

[`publish-api-image.yml`](../.github/workflows/publish-api-image.yml) builds the API from `main` when API or shared code changes and pushes it to `ghcr.io/ethanyap123/pulse-api`, tagged `latest` and with the commit SHA. The image is public and contains no secrets; all configuration comes from the environment.

Render doesn't redeploy when a new image is pushed. Until automatic deploys exist, use **Manual Deploy > Deploy latest reference** on each service.

## API configuration

Set on each Render service, with different values per environment:

| Variable         | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`   | The Neon **pooled** connection string for that environment's branch  |
| `JWT_SECRET`     | `openssl rand -hex 32`                                               |
| `ENCRYPTION_KEY` | `openssl rand -hex 32`. Changing it makes stored secrets unreadable. |
| `NODE_ENV`       | `production`                                                         |
| `APP_VERSION`    | `production` or `staging`                                            |

Render's health check path is `/health` on both services. When creating a service, select Free by hand: Render defaults to a paid instance type.

### Checking a change took effect

If a new deploy fails to start, Render keeps serving the previous instance, so a service can look healthy while running old settings. After changing configuration, check the version it reports:

```bash
curl https://pulse-api-0ep0.onrender.com/health/db
```

Production must answer `"version":"production"` and `"db":"ok"`. A free instance can take about a minute to wake up.

## Database migrations

Migrations run separately from the API, against the Neon **direct** (not pooled) connection string:

```bash
DATABASE_URL="<direct connection string>" pnpm --filter @pulse/api db:deploy
```

Run them on `staging` first. They only apply migrations that haven't run yet, so running them again is safe.
