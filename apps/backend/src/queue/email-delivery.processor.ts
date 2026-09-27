import { DelayedError, type Job } from "bullmq";
import type Redis from "ioredis";
import type { Sender } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { sendWithSender } from "../email/smtp.js";
import { getEmailDeliveryLockTtlMs, withEmailDeliveryLock } from "./email-delivery-lock.js";
import type { EmailDeliveryJobData, EmailDeliveryJobResult } from "./types.js";
import { getRateLimitConfig, reserveSenderSend, type RateDecision } from "./sender-rate-limiter.js";
import { notifySenderLimit } from "../slack/notifications.js";
import { enqueueEmailIndex } from "../search/email-index.queue.js";

type EmailDeliveryJob = Pick<Job<EmailDeliveryJobData, EmailDeliveryJobResult>, "id" | "data" | "attemptsMade" | "opts" | "moveToDelayed">;
type SendEmail = (sender: Sender, recipient: string, subject: string, body: string) => Promise<{ messageId: string; previewUrl?: string }>;

export interface EmailDeliveryRecord {
  id: string;
  status: "scheduled" | "processing" | "sent" | "failed";
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  sender: Sender;
  campaign: { userId: string };
}

export interface EmailDeliveryStore {
  find(id: string): Promise<EmailDeliveryRecord | null>;
  claim(id: string): Promise<boolean>;
  status(id: string): Promise<EmailDeliveryRecord["status"] | null>;
  markSent(id: string, result: { sentAt: Date; providerMessageId: string }): Promise<void>;
  markFailure(id: string, finalAttempt: boolean, lastError: string): Promise<void>;
}

const prismaStore: EmailDeliveryStore = {
  find: (id) => prisma.emailJob.findUnique({ where: { id }, include: { sender: true, campaign: { select: { userId: true } } } }),
  claim: async (id) => (await prisma.emailJob.updateMany({ where: { id, status: { not: "sent" } }, data: { status: "processing", attempts: { increment: 1 }, lastError: null } })).count > 0,
  status: async (id) => (await prisma.emailJob.findUnique({ where: { id }, select: { status: true } }))?.status ?? null,
  markSent: async (id, result) => { await prisma.emailJob.update({ where: { id }, data: { status: "sent", sentAt: result.sentAt, providerMessageId: result.providerMessageId, lastError: null } }); },
  markFailure: async (id, finalAttempt, lastError) => { await prisma.emailJob.update({ where: { id }, data: { status: finalAttempt ? "failed" : "processing", lastError } }); },
};

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Email delivery failed.";
  return message.slice(0, 4000);
}

export function createEmailDeliveryProcessor(options: {
  redis: Redis;
  ttlMs?: number;
  send?: SendEmail;
  reserve?: (senderId: string) => Promise<RateDecision>;
  notify?: (input: { senderId: string; userId: string; senderEmail: string; limit: number; hourStart: number }) => Promise<void>;
  store?: EmailDeliveryStore;
  indexChanged?: (emailJobId: string, revision: string) => Promise<void>;
}): (job: EmailDeliveryJob, token?: string) => Promise<EmailDeliveryJobResult> {
  const ttlMs = options.ttlMs ?? getEmailDeliveryLockTtlMs();
  const send = options.send ?? sendWithSender;
  const rateConfig = getRateLimitConfig();
  const reserve = options.reserve ?? ((senderId: string) => reserveSenderSend(options.redis, senderId, rateConfig));
  const notify = options.notify ?? ((input) => notifySenderLimit(options.redis, input));
  const store = options.store ?? prismaStore;
  const indexChanged = options.indexChanged ?? enqueueEmailIndex;
  const notifyIndex = (emailJobId: string, revision: string): void => {
    void indexChanged(emailJobId, revision).catch((error: unknown) => {
      console.error(`Could not request search indexing for EmailJob ${emailJobId}: ${error instanceof Error ? error.message : "index notification error"}`);
    });
  };

  return async (job, token) => withEmailDeliveryLock(options.redis, job.data.emailJobId, ttlMs, async () => {
    const record = await store.find(job.data.emailJobId);
    if (!record) throw new Error(`Email job ${job.data.emailJobId} does not exist.`);
    if (record.status === "sent") return { accepted: true, emailJobId: record.id };

    const decision = await reserve(record.senderId);
    if (decision.kind !== "allow") {
      if (!token) throw new Error("BullMQ worker token is required to reschedule a rate-limited job.");
      await job.moveToDelayed(Math.max(Date.now() + 1, decision.retryAt), token);
      if (decision.kind === "hourly-limit") {
        await notify({ senderId: record.senderId, userId: record.campaign.userId, senderEmail: record.sender.email, limit: rateConfig.hourlyLimit, hourStart: decision.hourStart });
      }
      throw new DelayedError();
    }

    const claimed = await store.claim(record.id);
    if (!claimed) {
      const currentStatus = await store.status(record.id);
      if (currentStatus === "sent") return { accepted: true, emailJobId: record.id };
      throw new Error("Email job could not be claimed.");
    }
    notifyIndex(record.id, `processing-${Date.now()}`);

    try {
      const result = await send(record.sender, record.recipientEmail, record.subject, record.body);
      await store.markSent(record.id, { sentAt: new Date(), providerMessageId: result.messageId });
      notifyIndex(record.id, `sent-${Date.now()}`);
      if (result.previewUrl) console.info(`Ethereal preview for ${record.id}: ${result.previewUrl}`);
      return { accepted: true, emailJobId: record.id };
    } catch (error) {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await store.markFailure(record.id, finalAttempt, safeMessage(error));
      notifyIndex(record.id, `failure-${Date.now()}`);
      throw error;
    }
  });
}
