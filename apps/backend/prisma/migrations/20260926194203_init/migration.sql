-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('scheduled', 'processing', 'sent', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senders" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "credentialRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "senders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "startTime" TIMESTAMPTZ(3) NOT NULL,
    "delayMs" INTEGER NOT NULL,
    "hourlyLimit" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "sentAt" TIMESTAMPTZ(3),
    "status" "EmailJobStatus" NOT NULL DEFAULT 'scheduled',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "bullJobId" TEXT,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "webhookUrlEncrypted" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "senders_userId_active_idx" ON "senders"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "senders_userId_email_key" ON "senders"("userId", "email");

-- CreateIndex
CREATE INDEX "campaigns_userId_createdAt_idx" ON "campaigns"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "campaigns_senderId_createdAt_idx" ON "campaigns"("senderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_bullJobId_key" ON "email_jobs"("bullJobId");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_providerMessageId_key" ON "email_jobs"("providerMessageId");

-- CreateIndex
CREATE INDEX "email_jobs_status_scheduledAt_idx" ON "email_jobs"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "email_jobs_senderId_status_scheduledAt_idx" ON "email_jobs"("senderId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "email_jobs_campaignId_sequenceNumber_idx" ON "email_jobs"("campaignId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_campaignId_sequenceNumber_key" ON "email_jobs"("campaignId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "slack_integrations_userId_key" ON "slack_integrations"("userId");

-- CreateIndex
CREATE INDEX "slack_integrations_teamId_channelId_idx" ON "slack_integrations"("teamId", "channelId");

-- AddForeignKey
ALTER TABLE "senders" ADD CONSTRAINT "senders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "senders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
