# Planned Data Model

## users

- id
- googleId
- name
- email
- avatarUrl
- createdAt
- updatedAt

## senders

- id
- userId
- email
- displayName
- Ethereal credential/config reference
- active
- createdAt
- updatedAt

## campaigns

- id
- userId
- subject
- body
- startTime
- delayMs
- hourlyLimit
- createdAt
- updatedAt

## email_jobs

One row per recipient.

- id
- campaignId
- senderId
- recipientEmail
- subject
- body
- sequenceNumber
- scheduledAt
- sentAt
- status
- attempts
- bullJobId
- providerMessageId
- lastError
- createdAt
- updatedAt

Statuses:

- scheduled
- processing
- sent
- failed

## slack_integrations

- id
- userId
- teamId
- teamName
- channelId
- channelName
- webhookUrl (stored securely; never exposed to browser)
- connectedAt
- disconnectedAt
- updatedAt
