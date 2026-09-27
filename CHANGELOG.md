# Changelog

## Unreleased

- Created the starter repository and persistent project-context system.
- Locked the initial technology direction without implementing application behavior yet.
- Scaffolded the Next.js + TypeScript + Tailwind frontend and Express + TypeScript backend in the pnpm workspace, with development, build, lint, and typecheck scripts. No business features were added.
- Added Prisma 7.10.0 Neon configuration, the five assignment data models, generated client/database module, database verification command, and initial migration applied to Neon.
- Replaced the Sender credential reference with explicit SMTP host, port, and encrypted username/password columns; applied the additive Neon migration.
- Added persistent local Redis configuration, typed BullMQ email queue and separate configurable worker, queue/persistence smoke scripts, Redis readiness, and Bull Board at `/admin/queues`.
- Implemented development-only campaign scheduling and email APIs, request idempotency with deterministic per-recipient BullMQ delayed jobs, AES-256-GCM encrypted Ethereal sender credentials, repeat-safe local sender seeding, SMTP delivery/retry state, and provider message tracking. Added an additive campaign idempotency migration; rate limits, spacing, OAuth, search, and frontend behavior remain unimplemented.
- Pinned Express 5.2.1 to match Bull Board 9's Express adapter runtime and updated its TypeScript types.
- Added token-owned Redis NX/PX delivery locks per EmailJob with compare-and-delete release and configurable TTL; extended the email listing API to validate and query comma-separated EmailJob statuses. Added executable concurrency, replay, and API-filter verification.
- Added atomic Redis per-sender UTC-hour rate reservations and minimum send spacing, BullMQ active-job delayed rescheduling without normal retry consumption, sequence-based queue priority, Slack OAuth v2 backend/disconnect/reconnect with encrypted credentials, and sender/hour-deduplicated Slack notifications. Added Phase 5 Redis/load and mocked restart verification; live Slack authorization and webhook delivery still require Slack app credentials.
- Fixed active-job rescheduling to use BullMQ's processor token argument (rather than assuming it exists on the Job object). Reworked rescheduling verification to use real BullMQ Workers and Redis with an injectable test store, verified five consecutive runs, and added a 1,000-job mocked-SMTP queue test.
- Extended Phase 5 verification to cover cross-connection delivery-lock exclusion, independent sender budgets, alert lifecycle behavior, and sent-job replay in the real-Worker test. Forced pnpm reinstall repaired an existing local dependency-link issue; no lockfile or schema changes were needed.
- Added Elasticsearch 9.5.4 Docker infrastructure with persistent volume and health check, plus `@elastic/elasticsearch` 9.5.1.
- Added a non-destructive `emails` index initializer with explicit mapping and a separate retryable `email-index` BullMQ queue/worker. PostgreSQL remains authoritative and reindexing repairs missed updates.
- Added tenant-scoped `GET /api/emails/search`, safe result fields, pagination/status filters, and repeatable PostgreSQL batch reindex and integration verification scripts.

- Added real Google authorization-code login using `google-auth-library@11.1.0`, exact `openid email profile` scopes, one-time Redis state bound to the initiating browser session, S256 PKCE, signed ID-token verification, and stable Google-subject User create/update behavior.
- Added Redis-backed `express-session` (`express-session@1.19.0`, `connect-redis@10.0.0`), HTTP-only configurable cookies, `/api/me`, logout, and session-to-PostgreSQL `requireAuth`. Replaced development-user protection on email APIs and Slack connect/status/disconnect with authenticated ownership; Slack callback ownership remains on signed single-use state.
- Enabled credentialed CORS for the exact configured frontend origin; updated safe environment examples and API/architecture/progress/validation documentation. Added a repeatable Redis/Neon auth and ownership verifier. Interactive Google sign-in still needs browser completion with the matching Google Console redirect URI.
- Verified the frontend foundation with a frozen pnpm workspace install, Next.js production build, TypeScript check, and ESLint. Confirmed the existing Tailwind CSS 3/PostCSS setup is ready for UI work, and ignored TypeScript build-cache output; no dependencies or product UI behavior needed to be added.
