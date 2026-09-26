# ReachInbox Hiring Assignment — Full-stack Email Job Scheduler

## Context

ReachInbox.ai is a product of Outbox Labs focused on transforming cold email outreach with AI-driven workflows. Our all-in-one solution empowers businesses to effortlessly find, enrich, and engage high-intent leads through cold email. With just a single prompt, ReachInbox springs into action, prospecting and verifying leads, crafting personalized email sequences, and notifying businesses of positive leads. ReachInbox is more than a tool; it's your growth partner.

## Problem Statement

Build a production-grade email scheduler service + dashboard that:

- Accepts email send requests via APIs
- Schedules them to be sent at a specific time
- Uses BullMQ + Redis as a persistent job scheduler (no cron jobs)
- Sends emails using fake SMTP via Ethereal Email
- Survives server restarts without restarting from scratch or losing jobs
- Exposes a frontend dashboard to schedule new emails, view scheduled emails, and view sent emails

## Tech Requirements

### Backend

- TypeScript
- Express.js
- BullMQ backed by Redis
- MySQL or PostgreSQL
- Ethereal Email SMTP

### Frontend

- React.js or Next.js
- Tailwind CSS or another modern CSS library
- TypeScript strongly preferred

### Infra

- Redis and DB can be run via Docker (recommended but not mandatory)

## Backend Requirements

### Core Scheduler Behavior

- Accept email scheduling requests via API
- Store them in relational DB
- Schedule using BullMQ delayed jobs or custom Redis/DB scheduler, but no cron
- Send emails from multiple senders via Ethereal
- Sent/scheduled emails must be searchable via Elasticsearch
- Expose a live BullMQ dashboard for real-time queue visibility
- Persist state so future emails still send after restart and emails are not duplicated/restarted from scratch

### Throughput, Rate Limiting & Concurrency

- Configurable worker concurrency
- Safe when jobs run in parallel
- Minimum delay between individual sends
- Configurable hourly email limit, global or per-sender/per-tenant
- Rate limiting must be safe across multiple workers/instances using Redis or DB-backed counters
- When hourly limit is reached, jobs must be delayed/rescheduled into next available hour window while preserving order as much as possible
- README must explain concurrency, delay, and rate limiting choices

### Slack Notification on Rate Limit Hit

- Dashboard Connect Slack button
- Real OAuth authorize flow
- Backend stores token/webhook per user/tenant
- Actually send a live Slack message when a sender's hourly limit is reached
- If Slack is not connected, do not notify and do not crash
- Later Slack connection must start notifications without redeploy
- Handle disconnect/reconnect

### Load Behavior

Clearly define behavior for 1000+ emails scheduled around the same time and when rate limits are exceeded. It is not required to actually send thousands through Ethereal.

### Hard Constraints

- Do not use OS cron
- Do not use Node cron libraries
- Scheduling must use BullMQ delayed jobs or the explicitly allowed custom Redis/DB scheduler
- State must persist through restart
- Same email queues should not be sent more than once; maintain idempotency

## Frontend Requirements

### Google Login

- Real Google OAuth login
- Redirect to dashboard after login
- Show user's name, email, avatar in top header
- Logout option

### Main Dashboard

- Top header
- Scheduled Emails section/tab
- Sent Emails section/tab
- Primary Compose New Email button
- Match provided Figma

### Compose New Email

- Subject
- Body
- Upload CSV/text list of email leads
- Parse and show number of email addresses detected
- Start time
- Delay between emails
- Hourly limit
- Schedule action sends data to backend
- May be modal or separate page depending on Figma

### Scheduled Emails

Show:

- Email
- Subject
- Scheduled time
- Status

Include loading and empty states.

### Sent Emails

Show:

- Email
- Subject
- Sent time
- Status: sent / failed

Include loading and empty states.

### Frontend Code Quality

- Clean folder structure
- Reusable UI components
- DRY code
- TypeScript types/interfaces for API responses and props
- Loading indicators
- Empty states
- Basic error handling/messages/toasts

## Submission

- Private GitHub repository
- Grant access to Mitrajit and Yadav036
- README with setup, Ethereal, env vars, architecture, persistence, rate limiting, concurrency, and implemented feature mapping
- Demo video max 5 minutes showing scheduling, dashboard, restart scenario, and optional rate-limit/delay behavior
- Document assumptions, shortcuts, and trade-offs
