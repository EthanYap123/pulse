# ADR-0003: Shared database with owner-scoped rows

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Pulse is multi-user: each user's projects, monitors, channels and history must be invisible to everyone else, except for status pages the owner makes public. The free tier gives one Neon project with 1 GB and 100 CU-hours, so per-tenant databases or schemas are not realistic. v1 has no teams; each project has exactly one owner.

## Decision

- **Single database, shared schema.** Tenancy is by `projects.owner_id`. Every tenant-owned table hangs off `projects` (`monitors`, `alert_channels`) or off `monitors` (`check_results`, rollups, `incidents`, `alert_deliveries`).
- **Enforced in the API's data layer.** Route handlers never call Prisma directly for tenant data; they go through repository functions that take the authenticated `userId` and always join or filter through `projects.owner_id`. For example, `getMonitor(userId, monitorId)` queries `WHERE id = $1 AND project.owner_id = $2`.
- **404, not 403,** for anything not owned by the caller, so IDs can't be probed.
- **Integration tests per resource** create two users and assert that user B gets 404 on every read, update and delete of user A's resources. These run in CI against the Postgres service container.
- **Public data is explicit.** Status pages only expose projects with `is_public = true`, and only monitors with `show_on_status_page = true`. Monitor URLs are not exposed.
- **Separate database roles.** The checker connects as `pulse_checker`, which cannot read `users` or `refresh_tokens`.
- **Per-user caps** (3 projects, 10 monitors) protect the shared free-tier budget from one heavy tenant.

## Consequences

**Good**

- Fits the free tier: one database, one migration path, one connection string per app.
- Simple to reason about; ownership is one join away for every row.
- Cross-tenant tests make leaks a CI failure rather than a code-review hope.

**Bad**

- Isolation depends on application code. A handler that bypasses the repository layer could leak data. Mitigations: a lint rule banning `prisma.*` imports outside `apps/api/src/repositories/`, and the cross-tenant test suite.
- Noisy neighbours share the same checker shards; caps limit the impact.
- Adding teams later means a `project_members` table and changing the ownership check from `owner_id = user` to membership. The repository layer keeps that change in one place.

## Alternatives considered

| Option                                                         | Why not (for v1)                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres Row-Level Security with `SET app.user_id` per request | Strong guarantee, but Prisma needs a transaction per request to set the session variable, which adds latency and complexity; the checker would need `BYPASSRLS`. Worth revisiting if teams are added. |
| Schema per tenant                                              | Migrations multiply per tenant; Prisma support is awkward; wasteful at this scale                                                                                                                     |
| Database (or Neon branch) per tenant                           | Neon free allows 10 branches; each would draw on the same compute budget                                                                                                                              |
