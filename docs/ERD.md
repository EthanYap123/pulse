# Data model (ERD)

**Last updated:** 2026-10-29 · Database: Postgres 17 (Neon in the cloud, Docker Compose locally) · Schema owner: Prisma (`apps/api/prisma/schema.prisma`)

```mermaid
erDiagram
  users ||--o{ refresh_tokens : "has sessions"
  users ||--o{ projects : owns
  projects ||--o{ monitors : contains
  projects ||--o{ alert_channels : "alerts to"
  monitors ||--o{ check_results : "raw, 7 days"
  monitors ||--o{ check_rollups_hourly : "30 days"
  monitors ||--o{ check_rollups_daily : "400 days"
  monitors ||--o{ incidents : has
  incidents ||--o{ alert_deliveries : triggers
  alert_channels ||--o{ alert_deliveries : receives

  users {
    uuid id PK
    citext email UK
    text password_hash "argon2id"
    timestamptz created_at
  }
  refresh_tokens {
    uuid id PK
    uuid user_id FK
    uuid family_id "rotation family"
    bytea token_hash UK "sha256 of token"
    timestamptz expires_at
    timestamptz revoked_at "nullable"
    uuid replaced_by "nullable"
    timestamptz created_at
  }
  projects {
    uuid id PK
    uuid owner_id FK
    text name
    text slug UK "status page URL"
    boolean is_public
    text status_note "nullable"
    timestamptz created_at
  }
  monitors {
    uuid id PK
    uuid project_id FK
    text name
    text url
    http_method method "GET or HEAD"
    smallint expected_status_min
    smallint expected_status_max
    smallint timeout_ms "1000-8000"
    smallint failure_threshold "1-5"
    jsonb headers "max 5, encrypted values"
    boolean is_paused
    boolean show_on_status_page
    smallint shard "0-4"
    monitor_status last_status "denormalised for the list view"
    timestamptz last_checked_at
    timestamptz created_at
    timestamptz updated_at
  }
  check_results {
    uuid monitor_id PK,FK
    timestamptz checked_at PK
    boolean ok
    smallint status_code "nullable"
    integer latency_ms "nullable"
    check_error error "nullable"
  }
  check_rollups_hourly {
    uuid monitor_id PK,FK
    timestamptz hour PK
    integer checks
    integer failures
    integer latency_avg_ms
    integer latency_p95_ms
    integer latency_max_ms
  }
  check_rollups_daily {
    uuid monitor_id PK,FK
    date day PK "UTC"
    integer checks
    integer failures
    integer latency_avg_ms
    integer latency_p95_ms
  }
  incidents {
    uuid id PK
    uuid monitor_id FK
    timestamptz started_at "first failed check"
    timestamptz resolved_at "nullable"
    check_error cause
    smallint last_status_code "nullable"
    resolve_reason resolve_reason "nullable"
    text note "nullable, max 500"
  }
  alert_channels {
    uuid id PK
    uuid project_id FK
    channel_type type "discord or telegram"
    text name
    bytea secret_enc "AES-256-GCM"
    smallint cooldown_minutes "default 10"
    channel_state state
    text disabled_reason "nullable"
    text link_code_hash "telegram linking, nullable"
    timestamptz link_expires_at "nullable"
    timestamptz created_at
  }
  alert_deliveries {
    uuid id PK
    uuid incident_id FK
    uuid channel_id FK
    alert_event event "opened or resolved"
    delivery_state state
    smallint attempts
    timestamptz next_attempt_at
    text last_error "nullable"
    timestamptz created_at
    timestamptz sent_at "nullable"
  }
```

## Enums

| Enum | Values |
| --- | --- |
| `http_method` | `GET`, `HEAD` |
| `monitor_status` | `pending`, `up`, `failing`, `down`, `recovering`, `paused` |
| `check_error` | `status`, `timeout`, `dns`, `tls`, `connection` |
| `resolve_reason` | `recovered`, `paused`, `deleted` |
| `channel_type` | `discord`, `telegram` |
| `channel_state` | `pending_link` (Telegram before `/start`), `active`, `disabled` |
| `alert_event` | `opened`, `resolved` |
| `delivery_state` | `pending`, `sent`, `suppressed`, `failed` |

## Constraints and indexes

| Table | Constraint / index | Why |
| --- | --- | --- |
| `users` | unique `email` (`citext`) | Case-insensitive login |
| `refresh_tokens` | unique `token_hash`; index `(family_id)` | Lookup on refresh; revoke a whole family on reuse |
| `projects` | unique `slug`; index `(owner_id)` | Public URL; tenant scoping |
| `monitors` | index `(project_id)`; index `(shard) WHERE NOT is_paused` | Dashboard list; hourly reconcile per shard |
| `monitors` | check `expected_status_min <= expected_status_max`, `timeout_ms BETWEEN 1000 AND 8000`, `failure_threshold BETWEEN 1 AND 5` | Mirrors the zod schema |
| `check_results` | PK `(monitor_id, checked_at)` | Idempotent flush (`ON CONFLICT DO NOTHING`); range scans for charts |
| `check_rollups_*` | PK `(monitor_id, hour/day)` | Idempotent upserts |
| `incidents` | **unique `(monitor_id) WHERE resolved_at IS NULL`** | At most one open incident per monitor (duplicate-alert layer 2) |
| `incidents` | index `(monitor_id, started_at DESC)` | Incident history |
| `alert_deliveries` | **unique `(incident_id, channel_id, event)`** | Idempotency key for the outbox (layer 3) |
| `alert_deliveries` | index `(channel_id, event, sent_at DESC)` | Cooldown lookup (layer 4) |
| `alert_deliveries` | index `(state, next_attempt_at) WHERE state = 'pending'` | Retry scan |

All foreign keys from `monitors` downwards use `ON DELETE CASCADE`, so deleting a project or monitor removes its history (US-05). `users -> projects` also cascades, for account deletion.

## Notes

- **Caps** (3 projects, 10 monitors per user, 5 channels per project, 200 global) are enforced by the API in a transaction, not by the schema, because they are config values.
- **`monitors.last_status` / `last_checked_at`** are denormalised and updated at the hourly flush and on incident events. The dashboard shows the live value from the checker and falls back to these when the checker can't be reached.
- **Secrets:** `alert_channels.secret_enc` holds the Discord webhook URL or the Telegram chat id, encrypted. Custom request header values in `monitors.headers` are encrypted the same way, because they often contain API keys.
- **Not stored in Postgres:** per-monitor counters and the unflushed check buffer live in the shard Durable Objects' SQLite (see [ARCHITECTURE.md](ARCHITECTURE.md#33-incident-detection)). Postgres is still the source of truth for config and history.
- **Uptime %** is `1 - failures / checks` over the period, summed from rollups. A day with zero checks (monitor paused or added later) shows as "no data", not 100%.
- **Storage estimate** at the global cap: < 100 MB (see [COSTS.md](COSTS.md#storage-budget-1-gb)).
