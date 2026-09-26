# Architecture

```text
Next.js Dashboard
       │
       ▼
Express API ───────────────► Neon PostgreSQL
       │
       │ create schedule
       ▼
BullMQ Queue ◄──────────── Redis
       │
       ▼
Email Worker
   │      │        │
   │      │        └──────► Elasticsearch (search index)
   │      └───────────────► Slack webhook (rate-limit alert)
   └──────────────────────► Ethereal SMTP
```

## Schedule creation

1. Frontend sends subject/body/recipients/start time/delay/hourly limit to the API.
2. API validates and normalizes recipient emails.
3. API stores the campaign and recipient email records in PostgreSQL.
4. API creates one BullMQ delayed job per recipient using its scheduled execution time.
5. API returns a schedule summary.

## Worker execution

1. BullMQ makes a delayed email job available.
2. Worker loads the durable email record.
3. Worker safely handles already-sent records.
4. Worker atomically checks sender spacing and hourly limit using Redis-backed state.
5. If the job cannot send yet, it is delayed/rescheduled rather than permanently failed.
6. If the hourly limit is reached, a once-per-sender-per-hour Slack alert is attempted when Slack is connected.
7. When allowed, the worker sends through Ethereal SMTP.
8. Worker persists the resulting state in PostgreSQL.
9. Search data is indexed in Elasticsearch.

## Restart behavior

PostgreSQL retains application state and Redis/BullMQ retains pending scheduled jobs. A server or worker restart must not require rebuilding schedules from scratch.

## Idempotency

The database email-job identifier is used as the deterministic BullMQ job identity. The worker checks durable email state before sending. Because SMTP and PostgreSQL are separate systems, the README must document the unavoidable crash window between provider acceptance and local persistence rather than claiming impossible transactional exactly-once delivery.
