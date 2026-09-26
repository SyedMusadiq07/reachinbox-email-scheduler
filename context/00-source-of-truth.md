# Source of Truth

## Authority order

1. `context/01-assignment.md` — functional requirements and hard constraints.
2. `context/figma/*` + `context/06-ui-reference.md` — frontend visual reference.
3. `context/02-decisions.md` — implementation decisions already approved for this project.
4. Current source code + tests — what has actually been implemented and verified.
5. Chat discussion — useful for decisions, but not persistent project state unless recorded here.

## Scope rule

Build only what is:

- explicitly required by the assignment,
- necessary to make a required feature work,
- or shown in the supplied Figma reference.

Do not add unrelated product features.

## Locked initial stack

- Next.js + TypeScript + Tailwind CSS
- Express.js + TypeScript
- PostgreSQL on Neon
- Prisma ORM
- BullMQ + Redis
- Elasticsearch
- Ethereal SMTP
- Bull Board
- Real Google OAuth
- Real Slack OAuth + incoming webhook integration
- Docker for local Redis and Elasticsearch

## Scheduling rule

BullMQ delayed jobs are the source of scheduled work. No cron or cron-like scheduler is permitted.
