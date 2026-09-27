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
- smtpHost
- smtpPort
- smtpUsernameEncrypted
- smtpPasswordEncrypted
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
- idempotencyKey (unique per user when supplied by the schedule API)
- requestHash (canonical request hash used to reject key reuse with different input)
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
- encrypted webhook URL ciphertext (never exposed to browser)
- encrypted OAuth access token ciphertext when available (never exposed to browser)
- connectedAt
- disconnectedAt
- updatedAt
