# API Contract

Implemented endpoints are marked below. Google OAuth/session endpoints, Slack OAuth, and Elasticsearch search are implemented.

## Auth

`GET /api/auth/google`

Starts Google's authorization-code flow. Requests only `openid email profile`; state and the S256 PKCE verifier are short-lived in Redis and bound to the starting browser session.

`GET /api/auth/google/callback`

Completes code exchange, verifies the signed Google ID token, creates or updates the User, and establishes the Redis-backed application session. The browser receives only an HTTP-only session cookie.

`GET /api/me`

Requires authentication and returns only `id`, `name`, `email`, and `avatarUrl`; unauthenticated requests return 401.

`POST /api/auth/logout`

Destroys the Redis-backed session, clears the session cookie, and returns `{ "loggedOut": true }`. Safe when already logged out.

Application routes resolve ownership from the session user ID via PostgreSQL. They ignore client-supplied user IDs. Sessions use `reachinbox.sid`, an HTTP-only cookie, default `SameSite=Lax`, `Secure` in production, and `SESSION_MAX_AGE_MS` (default one week). Exact-origin credentialed CORS uses `FRONTEND_URL` (local default `http://localhost:3000`); the backend defaults to port 4000.


## Scheduling

`POST /api/schedules`

Implemented for the authenticated session user. Requires an `Idempotency-Key` header. Repeating the same key and request reuses the existing campaign and recipient jobs, re-enqueuing missing deterministic BullMQ jobs. Reusing a key with a different request returns `409 Conflict`. The sender must belong to the authenticated user and be active; campaign ownership is derived from that session. Recipient addresses are trimmed, lowercased, and de-duplicated in first-seen order.

Request shape:

```json
{
  "subject": "Hello",
  "body": "Message body",
  "startTime": "2026-09-27T10:00:00.000Z",
  "delayMs": 2000,
  "hourlyLimit": 200,
  "senderId": "sender-id",
  "recipients": ["one@example.com", "two@example.com"]
}
```

`GET /api/senders`

Implemented. Lists safe sender fields for the current authenticated user.

`GET /api/emails?status=scheduled,sent,failed&page=1&pageSize=50`

Implemented. `status` accepts one or more comma-separated values from the existing EmailJobStatus enum (`scheduled`, `processing`, `sent`, `failed`) and filters with a Prisma `in` query. A single status remains supported; invalid values return `400`.

`GET /api/emails/search?q=phrase&status=sent&page=1&pageSize=20`

Implemented. Searches recipient email, subject, and body in Elasticsearch. `q` is required (up to 500 characters); queries containing `@` use exact case-insensitive recipient matching, while other queries search subject/body/analyzed recipient text. Optional `status` accepts one EmailJobStatus value. `page` defaults to 1 and `pageSize` defaults to 20, capped at 100; pages beyond the 10,000-result window return 400. Results are always filtered by current user ID and return only `id`, `recipientEmail`, `subject`, `status`, `scheduledAt`, and `sentAt`, with total/page/pageSize. Elasticsearch unavailability returns 503. PostgreSQL remains source of truth; `search:reindex` repairs the projection.

`GET /api/emails/:id`

Implemented. Returns a user-scoped email record with delivery status and provider message ID.

## Delivery notes

- Queue payloads contain only `{ "emailJobId": "..." }`; PostgreSQL is the source of truth.
- SMTP credentials use AES-256-GCM ciphertext and `CREDENTIAL_ENCRYPTION_KEY` (base64 encoded 32-byte key).
- BullMQ retries SMTP failures with exponential backoff. The crash window between provider acceptance and PostgreSQL persistence means exactly-once delivery is not guaranteed.
- A shared Redis lock excludes concurrent executions for one EmailJob. It uses a random token, atomic `SET NX PX`, token-checked Lua release, and `EMAIL_DELIVERY_LOCK_TTL_MS` (default 900000 ms). It is a delivery-exclusion lock, not a rate limiter.
- `ethereal:seed` creates or reuses at least two local Ethereal senders and never prints SMTP credentials.
- A separate BullMQ `email-index` queue retries Elasticsearch indexing independently of delivery. Search outages do not fail SMTP sends; missed index events can be repaired from PostgreSQL with `search:reindex`.

## Slack

`GET /api/auth/slack`

Starts Slack OAuth for the current Google-authenticated user. Redirect URI is configured with `SLACK_REDIRECT_URI`; signed Redis state binds the callback to that user.

`GET /api/integrations/slack/callback`

Completes Slack OAuth v2 (`incoming-webhook` scope), validates single-use state, and persists encrypted webhook/token values in the existing SlackIntegration row. The callback response contains team/channel display names only.

`GET /api/integrations/slack`

Returns connection status without exposing the webhook secret.

`DELETE /api/integrations/slack`

Disconnects Slack.

Rate-limit notifications use the stored incoming webhook. Redis `SET NX EX` deduplicates notification attempts by sender and UTC hour; missing/disconnected Slack is skipped and webhook errors do not fail email delivery. Per-sender limits use `MAX_EMAILS_PER_HOUR_PER_SENDER` (default 200), and `MIN_EMAIL_DELAY_MS` (default 2000) is enforced with Redis atomic reservations. Rate-limited active BullMQ jobs are moved to delayed state without incrementing normal retry attempts. Hourly buckets are UTC aligned and expire after two hours. Lower sequence numbers receive higher BullMQ priority, but concurrency and multiple campaigns prevent an absolute order guarantee.
