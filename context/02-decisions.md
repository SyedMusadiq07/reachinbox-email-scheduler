# Architecture Decisions

Status values: `PROPOSED`, `LOCKED`, `REVISIT`

## D001 — Repository structure

Decision: Use a simple pnpm monorepo with `apps/frontend` and `apps/backend`.

Status: LOCKED

## D002 — Frontend

Decision: Use Next.js + TypeScript + Tailwind CSS.

Reason: Directly satisfies the assignment and gives clean routing and component organization.

Status: LOCKED

## D003 — Backend

Decision: Use Express.js + TypeScript.

Status: LOCKED

## D004 — Database

Decision: Use PostgreSQL hosted on Neon.

Reason: PostgreSQL is explicitly allowed; Neon provides managed persistent PostgreSQL. Local Postgres is not required because the assignment only recommends Docker for the DB/Redis infrastructure.

Status: LOCKED

## D005 — ORM

Decision: Use Prisma.

Reason: Type-safe PostgreSQL access and migrations without unnecessary query-builder complexity.

Status: LOCKED

## D006 — Queue

Decision: Use BullMQ with Redis.

Status: LOCKED

## D007 — Local infrastructure

Decision: Run Redis and Elasticsearch through Docker. Keep PostgreSQL on Neon.

Status: LOCKED

## D008 — Scheduler

Decision: Use one durable BullMQ delayed job per recipient email. Do not use cron or cron-like polling.

Status: LOCKED

## D009 — Worker

Decision: Run the BullMQ email worker as a separate backend process with configurable concurrency. Initial default: 10.

Status: LOCKED

## D010 — Minimum send delay

Decision: Initial default minimum delay is 2000 ms, configurable through environment/config.

Status: LOCKED

## D011 — Hourly rate limit

Decision: Initial default is 200 emails per sender per hour, configurable through environment/config. Redis-backed state will be used so multiple workers/instances share the limit.

Status: LOCKED

## D012 — Search

Decision: PostgreSQL is the source of truth; Elasticsearch indexes searchable scheduled/sent email data.

Status: LOCKED

## D013 — Queue dashboard

Decision: Use Bull Board for the required live BullMQ dashboard.

Status: LOCKED

## D014 — Google auth

Decision: Real Google OAuth through the Express backend with an application session.

Status: LOCKED

## D015 — Slack integration

Decision: Real Slack OAuth with the incoming-webhook capability; persist integration data server-side and send a real webhook message when a sender hits its hourly limit.

Status: LOCKED

## D016 — Sender selection

Decision: Support multiple senders in the backend, and expose the sender in the compose flow because the supplied Figma shows a `From` selector. Sender creation/management UI is not added unless the assignment/Figma requires it.

Status: LOCKED
