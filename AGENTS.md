# Agent Instructions — ReachInbox Assignment

## Prime directive

Implement the ReachInbox hiring assignment exactly as specified in `context/01-assignment.md`.

The Figma screenshots stored in `context/figma/` and the observations in `context/06-ui-reference.md` are the visual source of truth for the frontend.

Do not add unrelated product features.

## Before every task

1. Read this file.
2. Read `context/00-source-of-truth.md`.
3. Read `context/02-decisions.md`.
4. Read `context/07-progress.md`.
5. Read any task-specific context file(s).
6. Inspect the existing code before modifying it.

## Non-negotiable constraints

- Backend must use TypeScript + Express.js.
- Queue must use BullMQ + Redis.
- Database must be PostgreSQL.
- SMTP must use Ethereal.
- Search must use Elasticsearch.
- Frontend must use React/Next.js and TypeScript.
- Styling must use Tailwind CSS or another modern CSS library; this project chooses Tailwind.
- Google login must be real OAuth.
- Slack connection must be real OAuth and must produce a real notification when an hourly sender limit is reached.
- Scheduling must use BullMQ delayed jobs or an equivalent Redis/DB scheduler explicitly allowed by the assignment.
- Do not use cron, node-cron, Agenda, OS cron, or cron-like polling schedulers.
- Worker concurrency must be configurable.
- Minimum delay between individual sends must be configurable.
- Hourly rate limiting must be configurable and safe across multiple workers/instances using Redis or DB-backed state.
- Rate-limited jobs must be rescheduled, not dropped.
- Scheduling state must survive server restarts.
- Maintain idempotency and do not intentionally duplicate sends.

## Change discipline

- Do not silently change a locked architecture decision.
- If a proposed change conflicts with `context/02-decisions.md`, stop and ask for a decision.
- Prefer the smallest change that satisfies the assignment.
- Do not rewrite working code unnecessarily.

## After every implementation task

1. Run relevant tests.
2. Run typecheck.
3. Run lint when configured.
4. Run the feature locally when practical.
5. Update `context/07-progress.md`.
6. Update `context/08-validation.md` with evidence/status.
7. Update `context/02-decisions.md` only if a real architectural decision was made.
8. Update `CHANGELOG.md` for user-visible/architectural changes.
9. Make a focused Git commit.

## Context is project memory

Never depend on chat memory. The repository context files are the persistent source of project state.
