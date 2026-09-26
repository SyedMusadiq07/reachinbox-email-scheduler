# Progress

## Phase 0 — Project foundation

- [x] Create persistent project context system
- [x] Lock initial technology direction
- [x] Capture Figma reference screenshots in repository
- [x] Initialize frontend application (Next.js + TypeScript + Tailwind scaffold; no dashboard/auth behavior)
- [x] Initialize backend application (Express + TypeScript scaffold; health endpoint only)
- [ ] Initialize Docker Redis/Elasticsearch setup

## Phase 1 — Database

- [ ] Prisma configured
- [ ] User model
- [ ] Sender model
- [ ] Campaign model
- [ ] EmailJob model
- [ ] SlackIntegration model
- [ ] Migrations

## Phase 2 — Queue/scheduler

- [ ] Redis connection
- [ ] BullMQ queue
- [ ] Delayed email jobs
- [ ] Separate worker
- [ ] Configurable worker concurrency
- [ ] Restart recovery
- [ ] Idempotency

## Phase 3 — Sending/rate limiting

- [ ] Ethereal integration
- [ ] Minimum inter-email delay
- [ ] Sender/hour Redis-backed rate limit
- [ ] Reschedule to next hour
- [ ] Multi-worker safety
- [ ] Slack rate-limit alert

## Phase 4 — Search/observability

- [ ] Elasticsearch indexing
- [ ] Search API
- [ ] Bull Board

## Phase 5 — Authentication/integrations

- [ ] Google OAuth
- [ ] Application session
- [ ] Slack OAuth
- [ ] Slack disconnect/reconnect

## Phase 6 — Frontend

- [ ] Login screen
- [ ] Dashboard
- [ ] Scheduled view
- [ ] Sent view
- [ ] Compose screen
- [ ] CSV/text recipient parsing
- [ ] Scheduling UI
- [ ] Loading/empty/error states
- [ ] User header/logout
- [ ] Figma visual refinement

## Phase 7 — Submission

- [ ] Automated tests
- [ ] Restart demo
- [ ] Rate-limit demo
- [ ] README complete
- [ ] Demo video <= 5 minutes
- [ ] Private GitHub repository
