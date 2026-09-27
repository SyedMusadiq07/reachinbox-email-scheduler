# Architecture

```text
Next.js Dashboard
       │
       ▼
Express API ───────────────────────► Neon PostgreSQL
       │                                  ▲
       ├── email jobs ─────► BullMQ/Redis │ load current EmailJob
       └── index events ───► BullMQ/Redis │
                                  │       │
                                  ▼       │
                         Email Index Worker
                                  │
                                  ▼
                           Elasticsearch

BullMQ email queue ──► Email Worker ──► Ethereal SMTP
                            ├────────► Slack webhook
                            └────────► email-index queue (state changes)
```

## Schedule creation (implemented)

1. Frontend sends subject/body/recipients/start time/delay/hourly limit to the API.
2. API validates and normalizes recipient emails.
3. API stores the campaign and recipient email records in PostgreSQL.
4. API creates one BullMQ delayed job per recipient using its scheduled execution time.
5. API returns a schedule summary. `Idempotency-Key` plus a normalized request hash makes HTTP retries reuse the same campaign and recipient rows. The API re-adds deterministic queue identities so retries repair missing jobs after a database success and Redis failure.

## Worker execution and per-sender throttling

1. BullMQ makes a delayed email job available.
2. Worker loads the durable email record.
3. Worker acquires the per-EmailJob Redis lock before rate reservation, then safely returns for records already marked sent.
4. A Redis Lua script uses Redis server time and atomically checks the current UTC hour count and sender's next-send timestamp. Only an allowed send increments the sender/hour counter and reserves the next-send timestamp. Counter keys expire after two hours; the next-send key also expires. `MIN_EMAIL_DELAY_MS` defaults to 2000 and `MAX_EMAILS_PER_HOUR_PER_SENDER` defaults to 200.
5. If the minimum gap has not elapsed, BullMQ moves the active job to the decision's retry timestamp. If the UTC-hour allowance is full, it moves the job to the next UTC hour. The worker uses `moveToDelayed(timestamp, token)` and throws `DelayedError`, so normal attempts are not consumed and the durable EmailJob is not failed. No polling or timer scheduler is used.
6. A shared Redis `SET NX EX` alert key per sender/hour gates at most one Slack notification attempt. A missing/disconnected integration is skipped. Webhook failures are logged without failing email delivery.
7. Lower campaign sequence numbers receive higher BullMQ priority. Separate campaigns and worker concurrency mean this is a best-effort ordering preference, not strict global order.
8. An allowed reservation is conservative: if a worker crashes or SMTP fails after reservation, the slot remains consumed for spacing/hourly-limit purposes. This avoids exceeding limits at the cost of possible under-utilization.
9. Worker sends through Ethereal SMTP and persists attempts, provider message ID, sent timestamp, and sanitized failure details. BullMQ retries SMTP failures with exponential backoff.

BullMQ's built-in limiter is global to a queue/worker, rather than independently scoped to each Sender; it cannot implement the required per-sender hourly budgets and inter-send reservations, so the shared Redis Lua limiter is used.

## Slack OAuth

The Google-authenticated user starts `GET /api/auth/slack`. OAuth v2 requests only `incoming-webhook`; signed, one-time state is bound to that user in Redis with a ten-minute expiry. `GET /api/integrations/slack/callback` exchanges the code and stores team/channel data plus AES-256-GCM encrypted webhook/token values in the existing SlackIntegration row. Status returns no credentials; DELETE marks the row disconnected, and a later OAuth install upserts it as connected. The callback remains state-bound and does not accept a client-supplied owner ID.

## Google OAuth and authenticated sessions

- `GET /api/auth/google` starts Google's authorization-code flow with only `openid email profile`. The official `google-auth-library` creates an S256 PKCE verifier/challenge. A cryptographically random state maps to a Redis record containing the flow name, creation time, verifier, and originating Express session ID; Redis expires it after ten minutes.
- `GET /api/auth/google/callback` atomically consumes state with Redis `GETDEL`, checks the flow age and browser session binding, exchanges the code with the matching PKCE verifier, and calls the official library's signed ID-token verification with the configured client ID as audience. Issuer, expiry, audience, subject, and verified email claims are checked before using identity fields. OAuth tokens are discarded and never returned or stored.
- A verified Google `sub` is the stable user key. Existing users are updated in place with verified email/name/avatar claims. If a different Google subject already owns the same verified email, login fails with a conflict instead of silently linking identities.
- Successful login regenerates the session ID to reduce session fixation risk and stores only the Prisma `User.id` in `express-session`. `connect-redis` stores session data in the same Redis deployment using a separate node-redis connection and a dedicated key prefix. The cookie is HTTP-only, has a configurable max age, uses `SameSite=Lax` by default, and is Secure in production (or whenever SameSite=None is explicitly configured).
- `requireAuth` resolves the session user ID from PostgreSQL on protected requests and sets the request's authenticated user. Email scheduling, sender/email listing, search, and Slack connect/status/disconnect use this identity; request body/query/header user IDs do not select ownership. The signed Slack callback state holds the user binding established by the authenticated Slack start route.
- Local development expects the frontend origin `http://localhost:3000` and backend origin `http://localhost:4000`. CORS allows only the configured frontend origin and credentials. For deployment, configure the exact frontend origin and a strong `SESSION_SECRET`; cross-site deployments may set `SESSION_COOKIE_SAME_SITE=none` and must use HTTPS.
- Automated verification uses an injected OAuth exchange to avoid requiring a Google account, while exercising the actual Redis state/session middleware and Neon user persistence. The production route still uses Google token exchange and `verifyIdToken`. Interactive Google consent/callback must be verified in a browser when credentials and the matching redirect URI are configured.


## Restart behavior

PostgreSQL retains application state and Redis/BullMQ retains pending scheduled jobs. A server or worker restart must not require rebuilding schedules from scratch.

## Idempotency

The database email-job identifier is used as the deterministic BullMQ job identity. The worker checks durable email state before sending. Because SMTP and PostgreSQL are separate systems, the README must document the unavoidable crash window between provider acceptance and local persistence rather than claiming impossible transactional exactly-once delivery.

## Redis/BullMQ infrastructure foundation

- The BullMQ queue is named `email`; its typed payload contains only the PostgreSQL `emailJobId`.
- Redis is provided locally by `redis:7-alpine` through `infra/docker-compose.yml`, with AOF persistence, a named `/data` volume, a container health check, and `maxmemory-policy noeviction`.
- Producers use a short-retry ioredis connection with the offline queue disabled. Workers use a dedicated ioredis connection with `maxRetriesPerRequest: null`, as required for worker reconnection behavior.
- The separate backend worker reads `WORKER_CONCURRENCY` (default 10), loads each durable EmailJob, skips records already marked sent, applies the shared sender/hour limiter, sends through SMTP using encrypted sender credentials, and persists delivery state.
- Each delivery is protected by `email:delivery-lock:{emailJobId}` in shared Redis, with a configurable `EMAIL_DELIVERY_LOCK_TTL_MS` (default 900000 ms). Lock contention throws a retryable processor error without changing PostgreSQL state. The random owner token is compared atomically before deletion. This prevents overlapping worker instances while the lease remains valid; a crash after SMTP acceptance and before PostgreSQL persistence can still lead to a later retry after lock expiry, so delivery is not exactly once.
- Bull Board is mounted in the Express API at `/admin/queues`. Redis readiness is available at `/health/redis`.
- Development scripts can enqueue immediate or delayed infrastructure-test jobs and inspect their BullMQ state. The persistence smoke procedure stops the worker, enqueues a delayed job, restarts Redis, confirms the job remains delayed, then restarts the worker and confirms completion.
- Normal application APIs require the Redis-backed Google session and resolve the owner from the stored User ID. The development-user runtime guard has been removed.
- Scheduling uses BullMQ delayed jobs, never polling or cron. PostgreSQL and Redis cannot share a transaction; a failed queue submission is retryable with the same idempotency key to repair missing deterministic jobs.
- SMTP acceptance and PostgreSQL persistence cannot be atomic. A crash after Ethereal accepts a message and before `sent` is committed can cause a retry and duplicate delivery; exactly-once delivery is not claimed.
- No cron-based process is introduced.

## Elasticsearch indexing and search

- PostgreSQL remains authoritative; the `emails` index is a rebuildable search projection. Its explicit mapping contains IDs, tenant and status as keywords; subject/body as text; and scheduled/sent/update timestamps as dates. Recipient email is a keyword with an analyzed text subfield. No SMTP credentials, Slack credentials, provider message IDs, or error details enter the index.
- The API and delivery worker enqueue identity-only events on the separate BullMQ `email-index` queue after schedule creation and after processing/sent/failure status writes. Index jobs load the current EmailJob and campaign owner from PostgreSQL and upsert using the EmailJob ID. Elasticsearch failure retries with exponential backoff on this queue and does not call into SMTP or change delivery state. Enqueue failures are logged and can be repaired by reindexing from PostgreSQL.
- `email-index` uses a separate worker and Redis connection from delivery. Its default concurrency is 5 (`SEARCH_INDEX_WORKER_CONCURRENCY`). Pending index jobs survive worker restarts. Status updates compare `updatedAt` so older index events do not overwrite newer projection data.
- Search always filters by the authenticated user's ID, then applies optional status and query filters. It returns only the ID, recipient, subject, status, scheduled time, and sent time. Elasticsearch outage returns `503` for search while delivery continues.
- Index initialization checks existence and creates the index with explicit mappings only when absent. It never deletes or recreates the index. `search:reindex` pages through PostgreSQL in batches and bulk-upserts by EmailJob ID; rerunning it repairs missing/stale documents without duplicates.
- Reindexing recovers from a crash after a PostgreSQL update but before its index event is enqueued, or exhausted queue retries. There is no cross-system PostgreSQL/Redis/Elasticsearch transaction; indexing is eventual.
