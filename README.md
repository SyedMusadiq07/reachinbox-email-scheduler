# ReachInbox — Full-stack Email Job Scheduler

This repository is the starter workspace for the ReachInbox Software Development Intern Assignment.

## Source of truth

- `context/00-source-of-truth.md` — implementation rules and locked scope
- `context/01-assignment.md` — assignment specification supplied for this project
- `context/02-decisions.md` — architectural decisions
- `context/03-architecture.md` — system architecture and flows
- `context/04-data-model.md` — planned relational data model
- `context/05-api-contract.md` — planned HTTP API contract
- `context/06-ui-reference.md` — Figma observations and UI constraints
- `context/07-progress.md` — current implementation state
- `context/08-validation.md` — verification checklist
- `context/09-demo.md` — final demo plan
- `AGENTS.md` — instructions for coding agents

## Technology direction

- Frontend: Next.js + TypeScript + Tailwind CSS
- Backend: Express.js + TypeScript
- Database: PostgreSQL hosted on Neon
- Queue: BullMQ backed by Redis
- Search: Elasticsearch
- SMTP: Ethereal
- Queue dashboard: Bull Board
- OAuth: Google + Slack
- Local infra: Docker for Redis and Elasticsearch

## Current state

This is intentionally a starter repository. The first implementation task is to scaffold the frontend/backend applications and infrastructure without changing the locked architecture or adding features outside the assignment.

## Development

See `context/02-decisions.md` and `context/07-progress.md` before making changes.
