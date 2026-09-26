# Validation Checklist

## Environment

## Scaffold validation — 2026-09-27

- [x] Frontend and backend production builds — verified with `pnpm.cmd build` (Next.js 14.2.35; backend TypeScript compilation)
- [x] Workspace typechecks — verified with `pnpm.cmd typecheck`
- [x] Workspace lint — verified with `pnpm.cmd lint`
- [ ] Automated tests — no tests exist in this scaffold; no test suite was run
- [ ] Local frontend/backend runtime smoke test — not run
- Note: `pnpm` PowerShell shim was blocked by execution policy; commands ran through `pnpm.cmd` (pnpm 9.15.4).
- Note: pnpm install and validation required approved outside-sandbox execution after sandbox filesystem restrictions blocked registry access and reading pnpm linked TypeScript files.
- Note: Git status/commit unavailable because this starter directory has no `.git` repository.

- [ ] Neon PostgreSQL connection works
- [ ] Redis Docker service works
- [ ] Elasticsearch Docker service works
- [ ] Environment validation rejects missing required secrets/config

## Authentication

- [ ] Google OAuth starts
- [ ] Callback creates/finds user
- [ ] Dashboard redirect works
- [ ] Name/email/avatar displayed
- [ ] Logout works

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
