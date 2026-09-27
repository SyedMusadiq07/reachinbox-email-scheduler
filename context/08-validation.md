# Validation Checklist

## Phase 6 — Elasticsearch search — 2026-09-27

- [x] Installed `@elastic/elasticsearch@9.5.1`; `pnpm.cmd install --frozen-lockfile` passed. A later `pnpm.cmd install --force` repaired the existing local `proper-lockfile`/`signal-exit` link mismatch. No Prisma schema or migration change was needed.
- [x] `docker compose -f infra/docker-compose.yml config --quiet` passed. `docker compose ... up -d elasticsearch` started `docker.elastic.co/elasticsearch/elasticsearch:9.5.4`; `docker compose ... ps` reported Elasticsearch healthy and Redis healthy.
- [x] The local ignored `apps/backend/.env` was missing `ELASTICSEARCH_URL`; added the non-secret local endpoint without reading or displaying existing values. `search:init` then passed without a command override and verified cluster reachability plus the non-destructive explicit `emails` mapping.
- [x] `search:verify` passed against Elasticsearch, Neon, and Redis: idempotent initialization/upsert, mapping, recipient/subject/body search, tenant isolation, status filter/update, pagination, actual authenticated HTTP route and safe response projection, scheduled/processing/sent/failed state projection, PostgreSQL bulk reindex repairing a deliberately removed test document, and mocked SMTP continuing while the indexing notification rejected with Elasticsearch URL unavailable.
- [x] `search:verify` queued a delayed index job, stopped its first worker, then confirmed the same job completed after a replacement worker started.
- [x] Restarted the Elasticsearch container. After it became healthy, `search:init` succeeded and `search:reindex` upserted 8 PostgreSQL EmailJobs. Repeated reindex returned the same count without duplicate documents.
- [x] `pnpm.cmd --filter @reachinbox/backend search:reindex` also completed successfully before the container restart. One attempt returned a Neon `ErrorEvent`; the immediate standalone retry passed. Neon `db:verify` likewise had one transient failure followed by a successful retry.
- [x] Backend `build`, `typecheck`, and `lint` passed after implementation. Prisma `db:validate`, Neon `db:verify`, and Redis `redis:verify` passed.
- [x] Regression checks passed: `phase5:verify-rate-limit`, `phase5:verify-bullmq-delay`, `phase5:verify-reschedule` (five real-worker repeats), `phase5:verify-load` (1,000 mocked jobs: 1 completed, 999 delayed, 0 failed), and `phase5:verify-restart` (mocked SMTP).
- [ ] No real Ethereal send was used for Phase 6 verification; SMTP behavior was mocked. A live production Elasticsearch outage was not induced; the worker was tested with an unavailable URL and a rejected indexing notification.
- Note: the first search verifier attempt exposed over-broad token matching for email-shaped input. The endpoint now uses exact case-insensitive recipient matching when `q` contains `@`; the final verifier passed.
- Note: the existing `phase4:verify-lock-and-email-filters` assertions printed as passing, but its process did not finish teardown during this run; it is not counted as a successful exit here. The Phase 5 real-worker reschedule and restart checks passed independently.

## Phase 5 — Distributed rate limiting and Slack backend — 2026-09-27

- [x] Corrected processor token handling: the processor now accepts BullMQ's second `token` argument and passes it to `job.moveToDelayed(timestamp, token)`.
- [x] `pnpm.cmd --filter @reachinbox/backend run phase5:verify-rate-limit` passed: separate Redis connections observed a 2-second minimum reservation gap; with a test limit of 3, exactly 3 of 20 concurrent reservations were allowed and the remaining 17 were directed to the next UTC hour; an independent sender was not blocked.
- [x] The same Redis verification produced exactly one successful alert claim from 30 concurrent claims, tested connected/disconnected/missing/reconnected notification behavior with a mocked HTTP sender, proved Sender A at its hourly cap did not block Sender B, checked delivery-lock exclusion from two connections, and ran 1,000 concurrent reservations (1 allowed, 999 retryable waits, none discarded).
- [x] `pnpm.cmd --filter @reachinbox/backend run phase5:verify-restart` passed using Neon records, a delayed BullMQ job, worker shutdown/restart, and mocked SMTP; restarted worker completed the job and PostgreSQL showed sent.
- [x] `pnpm.cmd --filter @reachinbox/backend run phase5:verify-reschedule` passed five consecutive real-Worker iterations using actual Redis/BullMQ active jobs and a test delivery store. Each run moved WAIT/hourly-limit jobs to delayed with original IDs; the WAIT job later completed; blocked attempts remained at zero; one mocked SMTP send then incremented attempts to one; a sent-job replay completed without a second SMTP call or attempt increment; no permanent failures occurred.
- [x] `pnpm.cmd --filter @reachinbox/backend run phase5:verify-load` passed with four BullMQ workers, each on its own Redis connection, and 1,000 queued mocked-SMTP jobs: 1 completed/sent, 999 delayed/scheduled, 0 failed, 0 waiting or active, 1 SMTP call, 1 attempt, and 1 alert claim. All 1,000 jobs remained accounted for.
- [x] `pnpm.cmd --filter @reachinbox/backend run phase5:verify-bullmq-delay` passed against a real isolated BullMQ queue/worker: `moveToDelayed(timestamp, workerToken)` followed by `DelayedError` left the active job in `delayed` state.
- [x] `pnpm.cmd --filter @reachinbox/backend run phase4:verify-lock-and-email-filters` passed with the new limiter dependency injected as allowed: lock concurrency, sent replay without a second SMTP call, and API status filters remain verified.
- [x] `pnpm.cmd --filter @reachinbox/backend run db:validate` and `db:generate` passed (Prisma 7.10.0). No schema change or migration was required.
- [x] `pnpm.cmd --filter @reachinbox/backend run redis:verify` passed (PONG); `db:verify` passed (Neon connectivity).
- Note: one later combined validation invocation hit the existing intermittent Neon connectivity failure; the standalone `db:verify` rerun passed.
- Root cause found: the old Neon-backed processor test mixed intermittent Neon/WebSocket setup with a fake Job carrying `.token`; BullMQ supplies the token as the processor's second argument. Production rescheduling incorrectly read `job.token`, which can be absent on a real BullMQ Job. The processor now takes the real processor token argument. The replacement test uses actual BullMQ/Redis and isolates only the delivery store, and passed five consecutive runs.
- [x] Backend `build`, `typecheck`, and `lint` passed.
- [x] A forced pnpm reinstall repaired a stale linked `proper-lockfile` dependency that had caused `onExit is not a function`; build, typecheck, and lint passed after repair.
- [ ] Live Slack OAuth code exchange and real Slack webhook delivery were not run: local environment does not have `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, or `SLACK_STATE_SECRET` configured. Mock lifecycle checks do not prove Slack service connectivity.
- SMTP-to-PostgreSQL crash window remains: SMTP can accept a message before the process crashes and before sent state is persisted; exactly-once external delivery is not guaranteed. A pre-SMTP Redis reservation may remain consumed after a crash/failure.
- [x] Source audit confirmed Slack OAuth creates signed random state, binds its nonce to the current development user in Redis, uses `GETDEL` for one-time consumption, and sets a 600-second expiry. Callback code exchange requests `incoming-webhook`; webhook URL and returned access token are encrypted before upsert. Status selects only team/channel/time fields; disconnect marks `disconnectedAt`; reconnect upserts encrypted current credentials and clears it. Missing/disconnected integrations are safely skipped by notification tests.
- Note: the latest run of the older Neon-backed Phase 4 lock/API-filter verification failed with a Neon WebSocket `ErrorEvent`; an additional retry stalled and was stopped. That combined check passed in earlier runs. Sent replay is independently covered by the repeatable real-Worker test above. The latest standalone Neon `SELECT 1` and worker-restart verifications passed.

## Phase 4 final fixes — 2026-09-27

- [x] Added a per-EmailJob Redis lock using a cryptographically random token, `SET ... PX ... NX`, configurable `EMAIL_DELIVERY_LOCK_TTL_MS` (default 900000 ms), and Lua compare-and-delete release.
- [x] `pnpm.cmd --filter @reachinbox/backend run phase4:verify-lock-and-email-filters` created temporary real EmailJobs in Neon and exercised two overlapping processor executions using separate Redis connections. Exactly one reached the injected SMTP function; the other received `EmailDeliveryLockBusyError`. The successful execution recorded sent once with one attempt.
- [x] The same verification replayed the sent EmailJob and confirmed SMTP call count remained one.
- [x] API verification in that script exercised `status=sent`, `status=failed`, `status=sent,failed`, and an invalid status; valid filters returned matching records and invalid status returned 400.
- [x] Restart verification created a future EmailJob through `POST /api/schedules`, stopped and restarted the worker while it was delayed, then verified the BullMQ job completed and the API reported sent with one attempt and a provider message ID.
- [x] Final backend `build`, `typecheck`, and `lint` passed after the lock, status filter, and worker shutdown cleanup changes.
- [x] A final `pnpm.cmd install --force` repaired an inconsistent local package link where `proper-lockfile` resolved incompatible `signal-exit` 4.x instead of its declared 3.x dependency; build/typecheck/lint passed after repair.
- No schema change or migration was required. The Redis lock excludes concurrent execution; TTL expiry after a process crash does not remove the external SMTP/PostgreSQL crash window and does not guarantee exactly-once delivery.

## Phase 4 scheduling and Ethereal delivery — 2026-09-27

- [x] Installed backend dependencies: Nodemailer 10.0.10, Zod 4.6.5, `@types/nodemailer` 8.0.2; pinned Express 5.2.1 to match Bull Board 9's Express adapter, with Express type definitions 5.0.6.
- [x] Added and applied `20260927120000_add_schedule_idempotency` using `pnpm.cmd --filter @reachinbox/backend run db:deploy`. The first `db:migrate --name ...` attempt was refused because `migrate dev` is interactive; no migration was applied by that attempt. `prisma migrate status` later reported three migrations and schema up to date.
- [x] `pnpm.cmd --filter @reachinbox/backend run db:validate` and `db:generate` passed with Prisma 7.10.0.
- [x] `pnpm.cmd install --force` repaired a partially inconsistent linked dependency tree after dependency changes. Final backend `build`, `typecheck`, and `lint` all passed.
- [x] Neon `db:verify` (`SELECT 1`) and Redis `redis:verify` (PING) passed after the dependency repair.
- [x] `ethereal:seed` created a development-only user and two distinct sender rows, then ran again successfully without adding more senders. SMTP passwords stayed encrypted and were not printed. The initial seed output included sender email addresses that also serve as SMTP usernames; the seed output now prints only sender IDs.
- [x] Started the API and separate worker. `GET /api/senders`, `POST /api/schedules`, `GET /api/emails/:id`, and `GET /api/emails?status=sent` were exercised. The schedule test supplied the same normalized address twice and persisted/enqueued one recipient-level job.
- [x] Ethereal accepted the test message; the worker persisted `sent`, `sentAt`, and provider message ID, and logged an Ethereal preview URL. The preview URL and credential values are intentionally omitted here.
- [x] Repeated the same schedule request with the same idempotency key and body; it returned the same campaign and EmailJob ID with `reused: true`.
- [x] Replayed an already-sent EmailJob under a new BullMQ ID; its database state and attempts stayed unchanged, so the worker skipped SMTP delivery.
- [x] Stopped and restarted the worker while a delayed job was pending. The restarted worker later delivered it and the API showed the sent state and provider message ID.
- [ ] SMTP acceptance and PostgreSQL persistence cannot be atomic. A crash in that interval can still cause a retry and duplicate delivery; exactly-once delivery is not claimed.
- [ ] Hourly limits, actual minimum send spacing, Slack/Google OAuth, Elasticsearch, and frontend business features remain unimplemented.
- Note: runtime Prisma/Neon operations encountered intermittent WebSocket network errors. A seed rerun succeeded, BullMQ retries recovered, and completed delivery plus final DB/API state were verified. Raw database connectivity checks passed.

## Redis + BullMQ infrastructure — 2026-09-27

- [x] Dependencies installed — BullMQ 6.3.9, ioredis 6.0.0, Bull Board 9.10.1 packages.
- [x] Redis started — `docker compose -f infra/docker-compose.yml up -d redis`; `redis:7-alpine` resolved to Redis 7.4.11.
- [x] Redis persistence/eviction configuration — AOF enabled, `appendfsync everysec`, `maxmemory-policy noeviction`, named data volume, and Docker health check healthy.
- [x] Redis reachability — `pnpm.cmd --filter @reachinbox/backend redis:verify` returned PONG; `/health/redis` returned ready.
- [x] Backend build — `pnpm.cmd --filter @reachinbox/backend build`.
- [x] Backend typecheck — `pnpm.cmd --filter @reachinbox/backend typecheck`.
- [x] Backend lint — `pnpm.cmd --filter @reachinbox/backend lint`.
- [x] Worker — started separately with concurrency 10 and processed the test jobs using placeholder behavior only.
- [x] Queue test — `queue:test` enqueued a test job which the worker completed.
- [x] Bull Board — `http://localhost:4000/admin/queues` returned HTTP 200.
- [x] Persistence/restart smoke — delayed job `persistence-test-1790453262092` was `delayed` before and after Redis container restart; after starting the worker again it was processed and inspected as `completed`.
- [x] Connection lifecycle — producer scripts and worker close their explicit ioredis connections; short-lived queue scripts exited after their result.
- No production scheduling, email sending, rate limiting, or database state changes were implemented in this phase.

## Sender SMTP schema correction — 2026-09-27

- [x] Safety check — Neon sender table was empty before adding required SMTP columns.
- [x] Migration — `20260926195332_add_sender_smtp_configuration` created and applied successfully.
- [x] Prisma client generation — `pnpm.cmd --filter @reachinbox/backend db:generate`
- [x] Prisma schema validation — `pnpm.cmd --filter @reachinbox/backend exec prisma validate`
- [x] Backend build — `pnpm.cmd --filter @reachinbox/backend build`
- [x] Backend typecheck — `pnpm.cmd --filter @reachinbox/backend typecheck`
- [x] Backend lint — `pnpm.cmd --filter @reachinbox/backend lint`
- [x] Neon connectivity — `pnpm.cmd --filter @reachinbox/backend db:verify`
- [x] Migration status — `pnpm.cmd --filter @reachinbox/backend exec prisma migrate status` reported two migrations and schema up to date.
- SMTP credential encryption/write logic was not implemented in this schema-only correction.

## Environment

## Neon + Prisma — 2026-09-27

- [x] Dependency installation — `pnpm.cmd install` completed
- [x] Prisma client generation — `pnpm.cmd --filter @reachinbox/backend db:generate` completed with Prisma 7.10.0
- [x] Initial migration — `pnpm.cmd --filter @reachinbox/backend run db:migrate --name init` created and applied `20260926194203_init` to Neon
- [x] Database connectivity — `pnpm.cmd --filter @reachinbox/backend db:verify` ran `SELECT 1` successfully
- [x] Backend build — `pnpm.cmd --filter @reachinbox/backend build`
- [x] Backend typecheck — `pnpm.cmd --filter @reachinbox/backend typecheck`
- [x] Backend lint — `pnpm.cmd --filter @reachinbox/backend lint`
- [x] Prisma schema validation — `pnpm.cmd --filter @reachinbox/backend exec prisma validate`
- [x] Migration state — `pnpm.cmd --filter @reachinbox/backend exec prisma migrate status` reported the database schema up to date
- [ ] Automated database tests — not added or run in this phase
- Sensitive local `.env` values were not printed or copied into tracked configuration.
- The first verification-script run exposed top-level `await` incompatibility with the CommonJS backend setup; the script was corrected and the database check then passed.

## Scaffold validation — 2026-09-27

- [x] Frontend and backend production builds — verified with `pnpm.cmd build` (Next.js 14.2.35; backend TypeScript compilation)
- [x] Workspace typechecks — verified with `pnpm.cmd typecheck`
- [x] Workspace lint — verified with `pnpm.cmd lint`
- [ ] Automated tests — no tests exist in this scaffold; no test suite was run
- [ ] Local frontend/backend runtime smoke test — not run
- Note: `pnpm` PowerShell shim was blocked by execution policy; commands ran through `pnpm.cmd` (pnpm 9.15.4).
- Note: pnpm install and validation required approved outside-sandbox execution after sandbox filesystem restrictions blocked registry access and reading pnpm linked TypeScript files.
- Note: Git status/commit unavailable because this starter directory has no `.git` repository.

- [x] Neon PostgreSQL connection works (see Neon + Prisma validation above)
- [ ] Redis Docker service works
- [ ] Elasticsearch Docker service works
- [ ] Environment validation rejects missing required secrets/config

## Authentication

- [x] Google OAuth authorization redirect verified over HTTP; provider login remains pending
- [x] Callback route creates/finds User with mocked OAuth exchange and live Neon persistence
- [x] Dashboard redirect checked in auth integration verification
- [x] `/api/me` safe identity fields verified in auth integration test
- [x] Logout and already-logged-out behavior verified in auth integration test

## Scheduling

- [ ] Scheduling API validates input
- [ ] Campaign stored in PostgreSQL
- [ ] One durable email job per recipient
- [ ] BullMQ delayed timestamp matches intended schedule
- [ ] Scheduled list shows pending jobs

## Sending

- [ ] Worker reads durable job
- [ ] Ethereal sends successfully
- [ ] Job transitions to sent
- [ ] Sent timestamp stored
- [ ] Failed state stored for permanent failure path

## Rate limiting

- [ ] Minimum delay enforced
- [ ] Hourly limit configurable
- [ ] Redis-backed and multi-worker safe
- [ ] Limit hit reschedules jobs
- [ ] Jobs are not dropped
- [ ] Order preserved as much as practical
- [ ] Slack alert sent once per sender/hour
- [ ] No Slack connection does not crash worker
- [ ] Reconnect works without redeploy

## Restart/idempotency

- [ ] Stop server/worker with future jobs pending
- [ ] Restart
- [ ] Future jobs remain
- [ ] Pending jobs continue
- [ ] Already-sent jobs are not intentionally re-sent

## Search/operations

- [ ] Scheduled emails searchable in Elasticsearch
- [ ] Sent emails searchable in Elasticsearch
- [ ] Bull Board displays live queue state

## Frontend UX

- [ ] Empty state
- [ ] Loading state
- [ ] Error state
- [ ] CSV/text recipient count
- [ ] Scheduled table/list
- [ ] Sent table/list
- [ ] Figma visual match reviewed against screenshots

## Phase 7 — Google OAuth and Redis-backed sessions — 2026-09-27

- [x] Dependency install added `google-auth-library@11.1.0`, `express-session@1.19.0`, `connect-redis@10.0.0`, `redis@5.11.0`, and `@types/express-session@1.19.0`. `pnpm.cmd install --force` repaired the existing local dependency-link mismatch; `pnpm.cmd install --frozen-lockfile` also passed.
- Note: an earlier `auth:verify` attempt returned a generic 502 during the mocked callback; the next run passed end to end. The transient cause was not established.
- [x] `pnpm.cmd --filter @reachinbox/backend auth:verify` passed with local Redis and Neon. It checked unauthenticated `/api/me`, senders and search return 401; random state, expiry/replay/invalid state; S256 challenge and verifier handoff; issuer/audience/expiry/verified-email claims; actual signature acceptance plus wrong-audience, expired, and tampered-signature rejection through Google's verifier; Neon user create/reuse/update; Redis session persistence across an API listener restart; logout; authenticated scheduling and scheduled listing; foreign sender/email isolation; and Slack state binding to the signed-in user.
- [x] The verifier uses an injected OAuth exchange so no Google account is required, while real Redis state/session middleware, Prisma persistence, middleware and protected routes are exercised. Production signature verification uses Google's `OAuth2Client.verifyIdToken`; the verifier accepted a correctly signed local test token and rejected wrong-audience, expired, and tampered-signature tokens.
- [x] A live backend request to `http://localhost:4000/api/auth/google` returned a 302 to Google's authorization endpoint with only `openid email profile`, S256 PKCE, state, and challenge. No credential/token values were printed.
- [ ] Interactive Google account login, real authorization-code callback, provider-side redirect URI registration, browser `/api/me`, and browser logout remain unverified. Credentials exist locally but the computer-use inventory exposed no browser surface in this run. Register `http://localhost:4000/api/auth/google/callback` as an authorized redirect URI in Google Cloud Console.
- Local ignored `apps/backend/.env` received a generated `SESSION_SECRET` because none was present, and its Google redirect path was aligned with `/api/auth/google/callback`; values were never printed. Auth test records were removed from Neon at script cleanup.
- [x] `pnpm.cmd --filter @reachinbox/backend db:validate` and `db:generate` passed (Prisma 7.10.0; schema unchanged).
- [x] `pnpm.cmd --filter @reachinbox/backend redis:verify` passed (`PONG`).
- [x] `pnpm.cmd --filter @reachinbox/backend db:verify` passed on retry with Neon. The first connection attempt failed transiently; the retry's trivial query succeeded.
- [x] `pnpm.cmd --filter @reachinbox/backend build`, `typecheck`, and `lint` passed after source changes.

## Frontend foundation verification — 2026-09-27

- [x] `pnpm.cmd install --frozen-lockfile` — workspace dependencies were already installed and the lockfile was current; no packages or lockfile changes were needed.
- [x] `pnpm.cmd --filter @reachinbox/frontend build` — Next.js 14.2.35 production build completed; app route `/` was statically prerendered.
- [x] `pnpm.cmd --filter @reachinbox/frontend typecheck` — TypeScript passed with no errors.
- [x] `pnpm.cmd --filter @reachinbox/frontend lint` — ESLint passed with no errors.
- [x] Reviewed Tailwind v3 config, Tailwind directives, PostCSS Autoprefixer integration, Next.js App Router root layout, workspace scripts, and ignored `.next` and TypeScript build-cache output. No frontend application screens or business behavior were added.
