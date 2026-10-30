# API contract

**Last updated:** 2026-10-29 · Version: `v1` · Request/response schemas are zod schemas in `packages/shared`; an OpenAPI document is generated from them in Phase 2 and served at `/docs` on the API.

Two HTTP surfaces exist:

1. **REST API** (`apps/api`, Render). Base URL in the browser: `/api/v1` on the web domain (Next.js rewrites to Render). Direct base URL: `https://<render-service>/v1`.
2. **Checker endpoints** (`apps/checker`, Cloudflare Worker): public status JSON, internal config sync, Telegram webhook.

## Conventions

- JSON in and out, UTF-8. Timestamps are ISO 8601 UTC strings. IDs are UUIDs.
- **Auth:** `Authorization: Bearer <access token>` (JWT, HS256, 15 min, claims `sub`, `iat`, `exp`). The refresh token is an opaque random string in the `pulse_rt` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`).
- **Errors** use RFC 9457 problem details (`application/problem+json`):

  ```json
  {
    "type": "https://github.com/EthanYap123/pulse/blob/main/docs/API.md#errors",
    "title": "Validation failed",
    "status": 422,
    "code": "validation_failed",
    "errors": [{ "path": "url", "message": "Private addresses are not allowed" }]
  }
  ```

- **Pagination:** cursor-based. `?limit=` (default 20, max 100) and `?cursor=`; responses include `nextCursor` (or `null`).
- **Rate limits:** headers `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. Auth endpoints 5/min per IP; writes 60/min per user; reads 300/min per user.
- **Ownership:** a resource owned by someone else returns **404**, not 403, so IDs can't be probed.

### Errors

| Status | `code`                | When                                                                      |
| ------ | --------------------- | ------------------------------------------------------------------------- |
| 400    | `bad_request`         | Malformed JSON                                                            |
| 401    | `unauthenticated`     | Missing/expired access token                                              |
| 401    | `invalid_credentials` | Wrong email or password (same message for both)                           |
| 404    | `not_found`           | Missing or not yours                                                      |
| 409    | `conflict`            | Duplicate slug                                                            |
| 409    | `limit_reached`       | Per-user or global cap hit (`limit`, `max` fields included)               |
| 422    | `validation_failed`   | zod validation errors, including SSRF-blocked URLs                        |
| 429    | `rate_limited`        | Too many requests (`Retry-After` header)                                  |
| 502    | `checker_unavailable` | Live status couldn't be fetched (response still includes last known data) |

## REST API

### Health

| Method | Path      | Auth | Response                                                                                                      |
| ------ | --------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| GET    | `/health` | none | `200 { "status": "ok", "db": "ok" \| "asleep", "version": "1.0.0" }` (does not wake Neon; reports pool state) |

### Auth

| Method | Path               | Body                  | Response                                                                                             |
| ------ | ------------------ | --------------------- | ---------------------------------------------------------------------------------------------------- |
| POST   | `/v1/auth/signup`  | `{ email, password }` | `201 { user, accessToken }` + sets `pulse_rt`                                                        |
| POST   | `/v1/auth/login`   | `{ email, password }` | `200 { user, accessToken }` + sets `pulse_rt`                                                        |
| POST   | `/v1/auth/refresh` | cookie                | `200 { accessToken }` + rotates `pulse_rt`. Reused token → `401`, whole family revoked               |
| POST   | `/v1/auth/logout`  | cookie                | `204`, token revoked, cookie cleared                                                                 |
| GET    | `/v1/me`           | bearer                | `200 { id, email, createdAt, usage: { projects, monitors }, limits: { projects: 3, monitors: 10 } }` |

`user` = `{ id, email, createdAt }`. Password rules: 10-128 chars.

### Projects

| Method | Path                      | Body                                       | Response                                         |
| ------ | ------------------------- | ------------------------------------------ | ------------------------------------------------ |
| GET    | `/v1/projects`            |                                            | `200 { items: Project[] }`                       |
| POST   | `/v1/projects`            | `{ name, slug, isPublic? }`                | `201 Project` · `409 conflict` / `limit_reached` |
| GET    | `/v1/projects/:projectId` |                                            | `200 Project`                                    |
| PATCH  | `/v1/projects/:projectId` | `{ name?, slug?, isPublic?, statusNote? }` | `200 Project`                                    |
| DELETE | `/v1/projects/:projectId` |                                            | `204` (cascades monitors, channels, history)     |

```ts
type Project = {
  id: string;
  name: string;
  slug: string;
  isPublic: boolean;
  statusNote: string | null;
  monitorCount: number;
  createdAt: string;
};
```

### Monitors

| Method | Path                               | Body / query            | Response                                    |
| ------ | ---------------------------------- | ----------------------- | ------------------------------------------- |
| GET    | `/v1/projects/:projectId/monitors` |                         | `200 { items: MonitorWithStatus[] }`        |
| POST   | `/v1/projects/:projectId/monitors` | `MonitorInput`          | `201 Monitor` · `409 limit_reached` · `422` |
| GET    | `/v1/monitors/:monitorId`          |                         | `200 MonitorWithStatus`                     |
| PATCH  | `/v1/monitors/:monitorId`          | `Partial<MonitorInput>` | `200 Monitor`                               |
| POST   | `/v1/monitors/:monitorId/pause`    |                         | `200 Monitor`                               |
| POST   | `/v1/monitors/:monitorId/resume`   |                         | `200 Monitor`                               |
| DELETE | `/v1/monitors/:monitorId`          |                         | `204`                                       |
| GET    | `/v1/monitors/:monitorId/checks`   | `?range=24h\|7d\|30d`   | `200 { range, points: LatencyPoint[] }`     |
| GET    | `/v1/monitors/:monitorId/uptime`   | `?days=1..90`           | `200 { days: DailyUptime[], uptimePct }`    |

```ts
type MonitorInput = {
  name: string; // 1-60 chars
  url: string; // http(s), public host only
  method?: "GET" | "HEAD"; // default GET
  expectedStatus?: { min: number; max: number }; // default 200-399
  timeoutMs?: number; // 1000-8000, default 8000
  failureThreshold?: number; // 1-5, default 3
  headers?: Record<string, string>; // max 5; values are write-only
  showOnStatusPage?: boolean; // default true
};

type Monitor = Omit<MonitorInput, "headers"> & {
  id: string;
  projectId: string;
  isPaused: boolean;
  headerNames: string[]; // values are never returned
  syncState: "synced" | "pending"; // checker config sync
  createdAt: string;
  updatedAt: string;
};

type MonitorWithStatus = Monitor & {
  status: "pending" | "up" | "failing" | "down" | "recovering" | "paused";
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  openIncidentId: string | null;
  statusSource: "live" | "last_flush";
};

// 24h: one point per check. 7d/30d: one point per hour.
type LatencyPoint = {
  t: string;
  ok: boolean;
  latencyMs: number | null; // 24h
  avgMs?: number;
  p95Ms?: number; // 7d / 30d
  failures?: number;
  checks?: number; // 7d / 30d
};

type DailyUptime = { day: string; uptimePct: number | null; checks: number };
```

### Incidents

| Method | Path                                | Body / query                          | Response                                    |
| ------ | ----------------------------------- | ------------------------------------- | ------------------------------------------- |
| GET    | `/v1/projects/:projectId/incidents` | `?status=open\|resolved&limit&cursor` | `200 { items: Incident[], nextCursor }`     |
| GET    | `/v1/incidents/:incidentId`         |                                       | `200 Incident & { deliveries: Delivery[] }` |
| PATCH  | `/v1/incidents/:incidentId`         | `{ note }` (max 500)                  | `200 Incident`                              |

```ts
type Incident = {
  id: string;
  monitorId: string;
  monitorName: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSec: number | null;
  cause: "status" | "timeout" | "dns" | "tls" | "connection";
  lastStatusCode: number | null;
  resolveReason: "recovered" | "paused" | "deleted" | null;
  note: string | null;
};

type Delivery = {
  channelId: string;
  channelName: string;
  event: "opened" | "resolved";
  state: "pending" | "sent" | "suppressed" | "failed";
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
};
```

### Alert channels

| Method | Path                               | Body                                                      | Response                                                                                             |
| ------ | ---------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/v1/projects/:projectId/channels` |                                                           | `200 { items: Channel[] }`                                                                           |
| POST   | `/v1/projects/:projectId/channels` | `{ type: "discord", name, webhookUrl, cooldownMinutes? }` | `201 Channel`                                                                                        |
| POST   | `/v1/projects/:projectId/channels` | `{ type: "telegram", name, cooldownMinutes? }`            | `201 Channel & { linkUrl: "https://t.me/<bot>?start=<code>", linkExpiresAt }` (state `pending_link`) |
| PATCH  | `/v1/channels/:channelId`          | `{ name?, webhookUrl?, cooldownMinutes?, enabled? }`      | `200 Channel`                                                                                        |
| POST   | `/v1/channels/:channelId/test`     |                                                           | `202` (test message queued) · `409` if not `active`                                                  |
| DELETE | `/v1/channels/:channelId`          |                                                           | `204`                                                                                                |

```ts
type Channel = {
  id: string;
  projectId: string;
  type: "discord" | "telegram";
  name: string;
  cooldownMinutes: number;
  state: "pending_link" | "active" | "disabled";
  disabledReason: string | null;
  target: string; // masked, e.g. "discord.com/api/webhooks/1234…" or "Telegram chat ****5678"
  createdAt: string;
};
```

Discord `webhookUrl` must match `https://discord.com/api/webhooks/<id>/<token>` (or `discordapp.com`). It is never returned in full.

## Checker endpoints (Cloudflare Worker)

### Public status

| Method | Path                      | Auth | Response                                                                            |
| ------ | ------------------------- | ---- | ----------------------------------------------------------------------------------- |
| GET    | `/public/v1/status/:slug` | none | `200 StatusPage` · `404` if missing or private. `Cache-Control: public, max-age=60` |

```ts
type StatusPage = {
  project: { name: string; slug: string; note: string | null };
  overall: "operational" | "degraded" | "outage" | "unknown";
  generatedAt: string; // live part
  snapshotAt: string | null; // last hourly snapshot
  monitors: Array<{
    id: string;
    name: string;
    status: "up" | "down" | "failing" | "recovering" | "paused" | "pending";
    uptime90dPct: number | null;
    days: Array<{ day: string; uptimePct: number | null }>; // 90 entries, oldest first
  }>;
  incidents: Array<{
    // last 14 days
    monitorName: string;
    startedAt: string;
    resolvedAt: string | null;
    durationSec: number | null;
    note: string | null;
  }>;
};
```

`overall`: `outage` if any shown monitor is `down`, `degraded` if any is `failing`/`recovering`, `operational` if all are `up`/`paused`, `unknown` if no checks yet.

### Live status (used by the API)

| Method | Path                | Auth | Response                                                                                                          |
| ------ | ------------------- | ---- | ----------------------------------------------------------------------------------------------------------------- |
| POST   | `/internal/v1/live` | HMAC | `{ monitorIds: string[] }` (max 50) → `200 { items: Array<{ monitorId, status, lastCheckedAt, lastLatencyMs }> }` |

### Config sync (called by the API)

| Method | Path                               | Auth | Body                                        |
| ------ | ---------------------------------- | ---- | ------------------------------------------- |
| POST   | `/internal/v1/monitors/sync`       | HMAC | `{ monitor: CheckerMonitorConfig }` → `204` |
| DELETE | `/internal/v1/monitors/:monitorId` | HMAC | → `204`                                     |

HMAC auth: headers `X-Pulse-Timestamp` (unix seconds) and `X-Pulse-Signature: sha256=<hex>` over `timestamp + "." + method + "." + path + "." + body`, with a shared secret. Requests older than 300 s are rejected; comparison is constant-time.

### Telegram webhook

| Method | Path                | Auth                                     | Body                                                                                                                                                         |
| ------ | ------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/telegram/webhook` | `X-Telegram-Bot-Api-Secret-Token` header | Telegram `Update`. On `/start <code>`: match the channel by code hash, store the encrypted chat id, set `active`, reply "Linked to <project>". Always `200`. |

## Story coverage

| Story               | Endpoint / page                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------ |
| US-01, US-02        | `/v1/auth/*`, `/v1/me`                                                                     |
| US-03               | `/v1/projects`                                                                             |
| US-04, US-05        | `/v1/projects/:id/monitors`, `/v1/monitors/:id`, pause/resume, sync to checker             |
| US-06               | `GET /v1/projects/:id/monitors` (live via `/internal/v1/live`)                             |
| US-07               | `GET /v1/monitors/:id/checks`                                                              |
| US-08               | Checker state machine; `/v1/projects/:id/incidents`                                        |
| US-09, US-10, US-11 | `/v1/projects/:id/channels`, `/v1/channels/:id/test`, `/telegram/webhook`, delivery outbox |
| US-12               | `PATCH /v1/incidents/:id`                                                                  |
| US-13, US-14        | `/status/<slug>` page ← `GET /public/v1/status/:slug`                                      |
| US-15               | Checker hourly job (no endpoint)                                                           |
