# Planned API Contract

This document is a planning contract. Update it whenever an API is actually implemented or intentionally changed.

## Auth

`GET /auth/google`

Starts Google OAuth.

`GET /auth/google/callback`

Completes Google OAuth and establishes the application session.

`GET /api/me`

Returns the currently authenticated user.

`POST /auth/logout`

Logs out the current user.

## Scheduling

`POST /api/schedules`

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

`GET /api/emails`

Lists scheduled/sent emails with status/time fields and pagination/filter support.

`GET /api/emails/search`

Searches indexed email data via Elasticsearch.

`GET /api/emails/:id`

Returns a single email record when needed by the UI.

## Slack

`GET /auth/slack`

Starts Slack OAuth.

`GET /auth/slack/callback`

Completes Slack OAuth and persists the integration.

`GET /api/integrations/slack`

Returns connection status without exposing the webhook secret.

`DELETE /api/integrations/slack`

Disconnects Slack.
