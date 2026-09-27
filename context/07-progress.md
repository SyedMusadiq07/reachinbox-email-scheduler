# Progress

## Phase 0 — Project foundation

- [x] Create persistent project context system
- [x] Lock initial technology direction
- [x] Capture Figma reference screenshots in repository
- [x] Initialize frontend application (Next.js + TypeScript + Tailwind scaffold; no dashboard/auth behavior)
- [x] Initialize backend application (Express + TypeScript scaffold; health endpoint only)
- [x] Initialize Docker Redis/Elasticsearch setup (Redis configured and verified; Elasticsearch service retained)

## Phase 1 — Database

- [x] Prisma 7.10.0 configured for Neon with pooled runtime and direct migration URLs
- [x] User model
- [x] Sender model with explicit encrypted Ethereal SMTP configuration
- [x] Campaign model
- [x] EmailJob model (one recipient-level record with sequence and queue ID uniqueness)
- [x] SlackIntegration model with ciphertext fields for OAuth secrets (encryption/write flow deferred to Slack OAuth phase)
- [x] Initial migration applied to Neon; connectivity verified

## Phase 2 — Queue/scheduler

- [x] Redis connection
- [x] BullMQ email queue with typed identity-only payload
- [x] BullMQ delayed-job infrastructure exercised by persistence tests (no production scheduling behavior)
- [x] Separate placeholder worker process
- [x] Configurable worker concurrency (default 10)
- [x] Delayed-job persistence verified across Redis restart and worker restart
- [x] Idempotent scheduling request key and deterministic queue IDs (implemented with the schedule API)

## Phase 3 — Sending/rate limiting

- [x] Ethereal SMTP delivery with encrypted sender credentials, retry tracking, and provider message persistence
- [x] Per-EmailJob Redis delivery lock excludes overlapping worker executions
- [x] Minimum inter-email delay enforced by shared Redis reservations
- [x] Sender/hour Redis-backed rate limit with atomic Lua decisions
- [x] Rate-limited jobs reschedule to the next available UTC time/hour without consuming retry attempts
- [x] Multi-worker safety verified with independent Redis connections
- [x] Slack rate-limit alert with atomic sender/hour deduplication; live webhook credentials still need configuration

## Phase 4 — Search/observability

- [x] Email API status filter supports sent and failed records together
- [x] Elasticsearch indexing
- [x] Search API
- [x] Bull Board at `/admin/queues`

## Phase 5 — Authentication/integrations

- [x] Google OAuth backend implementation (Phase 7; interactive provider login remains pending)
- [x] Redis-backed application session (Phase 7)
- [x] Slack OAuth v2 backend flow and encrypted persistence implemented; live OAuth requires Slack credentials
- [x] Slack disconnect/reconnect backend endpoints

## Phase 6 implementation — Elasticsearch search

- [x] Added Elasticsearch 9.5.4 Docker service configuration with persistent named data volume and health check; Redis configuration is unchanged.
- [x] Added official Elasticsearch JavaScript client 9.5.1 and environment-backed lazy client using `ELASTICSEARCH_URL`.
- [x] Added safe, non-destructive `emails` index initialization with explicit keyword/text/date mapping and no credential fields.
- [x] Configured the ignored local backend `.env` with the local Elasticsearch endpoint; the secret-free root `.env.example` retains the `ELASTICSEARCH_URL` setting.
- [x] Added separate retryable BullMQ `email-index` queue/worker; schedule, processing, sent, and failure changes enqueue current EmailJob identity, while PostgreSQL remains authoritative.
- [x] Added user-scoped `GET /api/emails/search` with query, optional status, pagination, and safe response projection.
- [x] Added batch PostgreSQL reindex (`search:reindex`) and integration verification (`search:verify`) scripts.
- [x] Docker Elasticsearch 9.5.4 started healthy with the persistent volume; non-destructive initialization and mapping checks passed.
- [x] Live search verification passed for recipient/subject/body, tenant isolation, status and pagination, repeated indexing, and scheduled/processing/sent/failed transitions through the processor with mocked SMTP.
- [x] Authenticated HTTP search route returned only safe fields; simulated index-notification/Elasticsearch unavailability did not stop mocked email delivery.
- [x] Delayed `email-index` job remained durable across worker shutdown/restart and completed after restart. Elasticsearch container restart recovered the index; PostgreSQL reindex upserted 8 EmailJobs and a repeat run stayed idempotent.
- [x] Backend build/typecheck/lint, Prisma validation, Neon connectivity, Redis PING, and Phase 5 limiter/reschedule/load/restart regression checks passed. See context/08-validation.md for transient Neon retry details.

## Phase 7 implementation — Google OAuth and Redis-backed sessions

- [x] Added official `google-auth-library` authorization-code login with only `openid email profile`, S256 PKCE, one-time random Redis state, ten-minute expiry, and originating Express session binding.
- [x] Verified ID tokens through Google's library against the configured audience, then validated issuer, expiry, subject, and verified email claims. Existing Google subjects reuse the same User ID and refresh name/avatar; email collisions with another subject are rejected rather than silently linked.
- [x] Added `express-session` with `connect-redis` on the existing Redis service, HTTP-only configurable cookie, required strong session secret, configurable max age and SameSite, plus session ID regeneration on login.
- [x] Added `/api/me`, `/api/auth/logout`, and `requireAuth`; replaced the runtime development-user guard for email APIs and Slack connect/status/disconnect. Slack callback ownership remains bound by its existing signed single-use state.
- [x] Configured exact-origin credentialed CORS and documented local frontend/backend origins. Updated `.env.example` for Google redirect URI and session settings; generated a new local session secret because none existed, without displaying it.
- [x] Added `auth:verify` covering unauthenticated API rejection, state expiry/replay, S256 PKCE, signed-token acceptance and wrong-audience/expired/tampered-token rejection, real Neon user persistence and repeat-login reuse, Redis session persistence across an API listener restart, logout, authenticated scheduling/listing, email/sender isolation, and Slack user binding.
- [x] Live backend `/api/auth/google` request returned Google's authorization URL with the required scopes and S256 challenge. Interactive browser login/callback was not completed because no browser surface was available; see `context/08-validation.md`.

## Phase 8 — Frontend

- [x] Frontend foundation verified: Next.js 14, React 18, TypeScript, Tailwind CSS 3, PostCSS, and Autoprefixer are installed in the pnpm workspace; existing scaffold remains free of product UI behavior.
- [x] Added `axios`, `swr`, and `lucide-react` for data fetching and icons. Created `api.ts` client and `AuthContext` for routing and session management.
- [x] Frontend production build, typecheck, and lint pass.
- [x] Login screen
- [x] Dashboard layout with sidebar (logo, user block, compose button, navigation, Slack integration) and top header (search, filter, refresh)
- [x] Scheduled view with Elasticsearch search integration
- [x] Sent view with Elasticsearch search integration
- [x] Email detail view with status, body rendering, and error display
- [x] Compose screen with sender dropdown, recipient chips, CSV/text upload, rich text editor, delay/hourly-limit inputs
- [x] CSV/text recipient parsing via file upload with email regex extraction and deduplication
- [x] Scheduling UI with Send Later panel, datetime picker, and preset options
- [x] Loading/empty/error states for all views
- [x] User header/logout via sidebar dropdown
- [ ] Figma visual refinement

## Phase 9 — Submission

- [ ] Automated tests
- [ ] Restart demo
- [ ] Rate-limit demo
- [ ] README complete
- [ ] Demo video <= 5 minutes
- [ ] Private GitHub repository

## Phase 5 implementation — Redis rate limiting and Slack backend

- [x] Added configurable `MIN_EMAIL_DELAY_MS` (default 2000), `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200), and Slack OAuth settings to the safe environment example. Existing delivery-lock TTL remains unchanged.
- [x] Added atomic sender-scoped Redis reservation using Redis server time, deterministic UTC hour buckets, expiring counters, and next-send spacing state.
- [x] Active jobs that exceed spacing/hourly limits use BullMQ `moveToDelayed(timestamp, token)` and `DelayedError`; attempts and durable EmailJob state are unchanged by rescheduling.
- [x] Applied higher BullMQ priority to lower campaign sequence numbers as a best-effort ordering preference.
- [x] Added Slack OAuth v2 `incoming-webhook` flow, signed one-time user-bound state, encrypted credential persistence using the existing SlackIntegration model, safe connection status, disconnect, and reconnect support.
- [x] Added one sender/hour Redis alert claim and safe skip/error behavior for missing or disconnected Slack.
- [x] Fixed the processor to use BullMQ's second processor argument as the active-job token. Verified the real Worker moves blocked jobs to delayed, reuses their original queue IDs, retries a WAIT job later, and leaves hourly-limited EmailJobs scheduled without attempts.
- [x] Replaced the flaky Neon-backed reschedule test with a real Redis/BullMQ Worker check using an injectable delivery store; five consecutive iterations passed, including sent-job replay without SMTP. Added real 1,000-job BullMQ load verification with mocked SMTP.
- [ ] Slack external OAuth/webhook behavior still needs live Slack credentials; only state/persistence source review and mocked notification lifecycle checks are available.
