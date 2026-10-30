# Product requirements: Pulse

**Status:** Draft for v1.0 · **Owner:** Ethan Yap · **Last updated:** 2026-10-29

## 1. Problem

Small teams and solo developers ship side projects, APIs and student apps on free hosting. Those apps go down (cold starts, expired databases, bad deploys) and nobody notices until a user complains. Existing monitors either cost money for the useful parts or don't give the developer a page they can share with users.

Pulse checks URLs and API endpoints on a schedule, tells the owner on Discord or Telegram when something breaks, and gives each project a public status page with uptime history. It runs entirely on free tiers, and its limits are designed around those tiers (see [COSTS.md](COSTS.md)).

## 2. Goals and non-goals

### Goals (v1.0)

1. Detect an outage within 15 minutes and alert the owner once, not repeatedly.
2. Give every project a shareable, login-free status page with 90 days of uptime.
3. Show response-time history so owners can spot slow endpoints.
4. Cost $0 to run, with limits that are explicit rather than surprising.

### Non-goals (v1.0)

- Checks more often than every 5 minutes, or from multiple regions.
- Keyword/body matching, TCP/ping/DNS/SSL-expiry checks, heartbeat (cron) monitors.
- Teams, roles or shared projects (one owner per project).
- Email or SMS alerts (Render's free tier blocks SMTP ports; SMS costs money).
- Custom domains for status pages, paid plans, billing.
- Manually posted incident updates beyond a single note per incident.

## 3. Personas

| Persona                      | Who                                                       | Needs                                                                | Frustrations                                  |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| **Solo developer (primary)** | Student or indie dev running 2-5 small apps on free hosts | Know when an app is down before users do; see if it's getting slower | Paid monitors; noisy alerts from one blip     |
| **Small-team maintainer**    | Runs a club, hackathon or community API used by others    | A public page to point users at during outages, with honest history  | Answering "is it down?" in chat over and over |
| **Visitor (end user)**       | Someone using one of those apps                           | Quickly check whether a problem is on their side or the service's    | Status pages that are themselves slow or down |

## 4. User stories and acceptance criteria

IDs are referenced from issues and tests. "Must" stories are v1.0; "Should" stories are v1.0 if time allows.

### Accounts

**US-01 (Must) Sign up.** As a solo developer, I want to create an account with email and password so my monitors are private to me.

- Given a valid email and a password of at least 10 characters, when I sign up, then an account is created and I am signed in.
- Passwords are stored only as argon2id hashes.
- Signing up with an email that already exists returns a generic error that does not confirm the email exists.

**US-02 (Must) Sign in and stay signed in.** As a returning user, I want to stay signed in across visits without re-entering my password every 15 minutes.

- Access tokens expire after 15 minutes; a refresh token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie renews them for up to 30 days.
- Refresh tokens rotate on every use; reusing an old one revokes the whole session family.
- Signing out revokes the refresh token server-side.

### Projects and monitors

**US-03 (Must) Create a project.** As a solo developer, I want to group monitors into a project so each app gets its own status page.

- A project has a name and a unique URL slug (lowercase letters, digits, hyphens, 3-40 chars).
- A user can own at most 3 projects; creating a 4th returns a clear limit error.

**US-04 (Must) Add a monitor.** As a solo developer, I want to add an HTTP(S) URL to check so I learn when it stops responding.

- Fields: name, URL, method (`GET` or `HEAD`), expected status range (default 200-399), timeout (1-8 s, default 8), failure threshold (1-5, default 3), optional request headers (max 5).
- Only `http`/`https` URLs to public hosts are accepted. `localhost`, private, loopback, link-local and metadata IP ranges are rejected (SSRF protection, hardened in Phase 5).
- A user can have at most 10 monitors; when the global cap (200) is reached, creation is refused with a message saying so.
- The first check runs within 5 minutes of creation.

**US-05 (Must) Edit, pause and delete monitors.** As a solo developer, I want to change or pause a monitor during planned maintenance.

- Paused monitors are not checked and do not open incidents; the status page shows them as "Paused".
- Changes reach the checker within 5 minutes.
- Deleting a monitor deletes its history and closes any open incident.

### Checks and status

**US-06 (Must) See current status.** As a solo developer, I want a dashboard listing every monitor with its current state so I can see everything at a glance.

- Each monitor shows Up / Down / Paused / Pending (no checks yet), the last check time and last response time.
- Current state is no more than 5 minutes behind the last completed check.

**US-07 (Must) See response-time history.** As a solo developer, I want a latency chart per monitor so I can spot slow endpoints.

- Ranges: 24 hours (raw checks), 7 days and 30 days (hourly averages and p95).
- Failed checks are shown as gaps or marked points, not as zero latency.

### Incidents and alerts

**US-08 (Must) Incident detection.** As a solo developer, I want an incident opened only after repeated failures so a single blip doesn't wake me up.

- A check fails when it times out, can't connect, fails TLS, or returns a status outside the expected range.
- An incident opens after N consecutive failures (the monitor's failure threshold, default 3).
- It resolves after 2 consecutive successes. Duration is measured from the first failed check to the first successful one.
- A monitor never has more than one open incident.

**US-09 (Must) Discord alerts.** As a solo developer, I want alerts in my Discord channel.

- I can add a Discord webhook URL as an alert channel and send a test message.
- I get exactly one message when an incident opens and one when it resolves, with monitor name, URL, cause and duration.
- If Discord returns 404 (webhook deleted), the channel is disabled and the dashboard shows why.

**US-10 (Must) Telegram alerts.** As a solo developer, I want alerts in Telegram.

- I link a chat by opening a one-time deep link to the Pulse bot (`/start <code>`, code valid 15 minutes); no bot token is ever handled by the user.
- Same open/resolve messages and test message as Discord.

**US-11 (Must) No alert storms.** As a solo developer, I don't want a flapping service to spam me.

- After an alert for a monitor, further _open_ alerts for that monitor on the same channel are suppressed for a cooldown (default 10 minutes); suppressed alerts are recorded, not lost.
- Retries after a failed send never produce a duplicate message for the same incident event.

**US-12 (Should) Incident history and note.** As a small-team maintainer, I want to see past incidents and add one short note (e.g. root cause) that appears on the status page.

### Public status page

**US-13 (Must) Public status page.** As a visitor, I want to open a project's status page without logging in to see whether the service is up.

- URL: `/status/<slug>`. Shows overall status, each public monitor's current state, and incidents from the last 14 days.
- Loads in under 1.5 s on a warm cache and **never depends on the API being awake** (no Render cold start).
- Owners can hide individual monitors or make the whole page private.

**US-14 (Must) 90-day uptime bars.** As a visitor, I want a 90-day history bar per monitor so I can judge reliability.

- One bar per UTC day, colour-coded by uptime (100%, ≥99%, ≥95%, <95%, no data), with the percentage on hover/focus.
- The overall 90-day uptime % is shown per monitor.
- Today's bar may be up to 1 hour behind (updated at the hourly rollup).

### Housekeeping

**US-15 (Must) Data retention.** As the operator, I want old data rolled up and deleted automatically so the database stays under 1 GB.

- Raw checks are kept 7 days, hourly rollups 30 days, daily rollups 400 days. Resolved incidents are kept 400 days.
- The job runs hourly from the Worker cron and is idempotent.

## 5. Non-functional requirements

| ID     | Area                     | Requirement                                                                                                                                                                                                                                    |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-01 | Check interval           | Every monitor is checked every **5 minutes** (fixed in v1).                                                                                                                                                                                    |
| NFR-02 | Detection latency        | Incident opens within `threshold x 5 min` of the first failure (15 min at the default threshold). Alert sent within 1 minute of the incident opening.                                                                                          |
| NFR-03 | Caps                     | 3 projects and 10 monitors per user; 5 alert channels per project; 200 active monitors globally. Caps are config values, enforced by the API and shown in the UI.                                                                              |
| NFR-04 | Check timeout            | 1-8 seconds per check. Response bodies are not downloaded beyond headers.                                                                                                                                                                      |
| NFR-05 | Data retention           | Raw 7 days, hourly rollups 30 days, daily rollups 400 days.                                                                                                                                                                                    |
| NFR-06 | Status page availability | Served from Vercel ISR + Worker snapshots; stays up when the API (Render) or Neon is asleep or out of compute.                                                                                                                                 |
| NFR-07 | Dashboard performance    | API p95 under 300 ms when warm (measured with k6 in Phase 5). A cold start (~1 min on Render) is shown as a "waking up" state, not an error.                                                                                                   |
| NFR-08 | Security                 | argon2id passwords; rotated refresh tokens; zod validation on every input; rate limits on auth (5/min/IP) and writes; SSRF blocking; alert secrets (webhook URLs) encrypted at rest with AES-256-GCM; no secrets in the repo (gitleaks in CI). |
| NFR-09 | Privacy                  | Only email and password hash are stored about a user. Status pages show monitor names, not URLs, unless the owner opts in.                                                                                                                     |
| NFR-10 | Accessibility            | Dashboard and status pages meet WCAG 2.2 AA: keyboard reachable, status never conveyed by colour alone, contrast ≥ 4.5:1.                                                                                                                      |
| NFR-11 | Cost                     | $0 per month on free tiers with no card on file. Free-tier usage stays under 60% of each limit at the global cap (see COSTS.md).                                                                                                               |
| NFR-12 | Observability            | Structured JSON logs (pino), `/health` endpoint, Sentry for API and web errors.                                                                                                                                                                |
| NFR-13 | Quality                  | CI runs lint, typecheck, unit and integration tests, build, image scan and secret scan on every PR; coverage ≥ 80% on `packages/shared`.                                                                                                       |

## 6. Success metrics (v1.0)

- Pulse monitors Ethan's own deployed projects for 30 days with no missed outage and no duplicate alert.
- Neon usage stays under 60 CU-hours in a full month.
- A new user can go from sign-up to a live status page in under 3 minutes (Playwright E2E covers this path).

## 7. Release plan

Phases 0-7 are tracked as GitHub milestones. v1.0.0 is tagged at the end of Phase 6.

## 8. Open questions

1. Render card requirement (see COSTS.md risks). Fallback: API as Next.js route handlers on Vercel.
2. Should the failure threshold apply per monitor (current plan) or per project?
3. Is a 400-day daily history worth the storage, or is 90 days enough for v1?
