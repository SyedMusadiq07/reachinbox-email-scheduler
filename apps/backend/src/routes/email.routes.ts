import { createHash, randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { EmailJobStatus as EmailJobStatusValues } from "../generated/prisma/enums.js";
import type { EmailJobStatus } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { emailQueue } from "../queue/email.queue.js";
import { EMAIL_DELIVERY_JOB_NAME } from "../queue/types.js";
import { enqueueEmailIndexes } from "../search/email-index.queue.js";
import { searchEmails } from "../search/email-search.js";
import nodemailer from "nodemailer";
import { encryptCredential } from "../email/credentials.js";

export const emailRouter = Router();

const scheduleSchema = z.object({
  senderId: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  startTime: z.string().datetime({ offset: true }),
  delayMs: z.number().int().nonnegative(),
  hourlyLimit: z.number().int().positive(),
});

emailRouter.get("/senders", async (_request, response) => {
  const senders = await prisma.sender.findMany({
    where: { userId: response.locals.userId, active: true },
    select: { id: true, email: true, displayName: true },
    orderBy: { createdAt: "asc" },
  });
  response.json({ items: senders });
});

emailRouter.post("/senders", async (request, response) => {
  const schema = z.object({ email: z.string().email(), displayName: z.string().min(1).optional() });
  const parsed = schema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid email." });
    return;
  }
  const userId = response.locals.userId as string;
  try {
    const testAccount = await nodemailer.createTestAccount();
    const sender = await prisma.sender.create({
      data: {
        userId,
        email: parsed.data.email,
        displayName: parsed.data.displayName || parsed.data.email,
        smtpHost: testAccount.smtp.host,
        smtpPort: testAccount.smtp.port,
        smtpUsernameEncrypted: encryptCredential(testAccount.user),
        smtpPasswordEncrypted: encryptCredential(testAccount.pass),
      },
      select: { id: true, email: true, displayName: true }
    });
    response.status(201).json(sender);
  } catch (error) {
    console.error("Failed to add sender:", error);
    response.status(500).json({ error: "Failed to add sender." });
  }
});

emailRouter.post("/schedules", async (request, response) => {
  const parsed = scheduleSchema.safeParse(request.body);
  const key = request.header("Idempotency-Key")?.trim();
  if (!parsed.success || !key || key.length > 255) {
    response.status(400).json({ error: "Invalid schedule request or missing/invalid Idempotency-Key.", details: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  const input = parsed.data;
  const userId = response.locals.userId as string;
  const sender = await prisma.sender.findFirst({ where: { id: input.senderId, userId, active: true } });
  if (!sender) {
    response.status(404).json({ error: "Active sender not found." });
    return;
  }
  const recipients = [...new Set(input.recipients.map((email) => email.trim().toLowerCase()))];
  const canonical = JSON.stringify({ ...input, recipients });
  const requestHash = createHash("sha256").update(canonical).digest("hex");
  const startTime = new Date(input.startTime);

  let campaign = await prisma.campaign.findFirst({
    where: { userId, idempotencyKey: key },
    include: { emailJobs: { orderBy: { sequenceNumber: "asc" } } },
  });
  let created = false;
  if (campaign && campaign.requestHash !== requestHash) {
    response.status(409).json({ error: "Idempotency-Key was already used with a different request." });
    return;
  }
  if (!campaign) {
    const jobs = recipients.map((recipientEmail, sequenceNumber) => {
      const id = randomUUID();
      return {
        id,
        bullJobId: id,
        recipientEmail,
        subject: input.subject,
        body: input.body,
        sequenceNumber,
        scheduledAt: new Date(startTime.getTime() + sequenceNumber * input.delayMs),
        senderId: sender.id,
      };
    });
    try {
      campaign = await prisma.campaign.create({
        data: {
          userId,
          senderId: sender.id,
          subject: input.subject,
          body: input.body,
          startTime,
          delayMs: input.delayMs,
          hourlyLimit: input.hourlyLimit,
          idempotencyKey: key,
          requestHash,
          emailJobs: { create: jobs },
        },
        include: { emailJobs: { orderBy: { sequenceNumber: "asc" } } },
      });
      created = true;
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      campaign = await prisma.campaign.findFirst({ where: { userId, idempotencyKey: key }, include: { emailJobs: { orderBy: { sequenceNumber: "asc" } } } });
      if (!campaign) throw error;
      if (campaign.requestHash !== requestHash) {
        response.status(409).json({ error: "Idempotency-Key was already used with a different request." });
        return;
      }
    }
  }

  try {
    await emailQueue.addBulk(campaign.emailJobs.map((job) => ({
      name: EMAIL_DELIVERY_JOB_NAME,
      data: { emailJobId: job.id },
      opts: { jobId: job.bullJobId ?? job.id, priority: job.sequenceNumber + 1, delay: Math.max(0, job.scheduledAt.getTime() - Date.now()) },
    })));
  } catch {
    response.status(503).json({ error: "Schedule saved, but queue submission failed. Retry with the same Idempotency-Key.", campaignId: campaign.id });
    return;
  }
  await enqueueEmailIndexes(campaign.emailJobs.map((job) => job.id), `scheduled-${Date.now()}`);
  response.status(created ? 201 : 200).json({ campaignId: campaign.id, emailJobCount: campaign.emailJobs.length, emailJobIds: campaign.emailJobs.map((job) => job.id), reused: !created });
});

emailRouter.get("/emails", async (request, response) => {
  const statusQuery = request.query.status;
  const requestedStatuses = typeof statusQuery === "string"
    ? statusQuery.split(",").map((status) => status.trim())
    : undefined;
  const validStatuses = new Set<string>(Object.values(EmailJobStatusValues));
  if (statusQuery !== undefined && (!requestedStatuses?.length || requestedStatuses.some((status) => !validStatuses.has(status)))) {
    response.status(400).json({ error: `status must be a comma-separated list of: ${[...validStatuses].join(", ")}.` });
    return;
  }
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(request.query.pageSize ?? "50"), 10) || 50));
  const where = {
    campaign: { userId: response.locals.userId as string },
    ...(requestedStatuses ? { status: { in: requestedStatuses as EmailJobStatus[] } } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.emailJob.count({ where }),
    prisma.emailJob.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, recipientEmail: true, subject: true, scheduledAt: true, sentAt: true, status: true, attempts: true, lastError: true } }),
  ]);
  response.json({ items, total, page, pageSize });
});

emailRouter.get("/emails/search", async (request, response) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const validStatuses = new Set<string>(Object.values(EmailJobStatusValues));
  if (!q || q.length > 500 || (status && !validStatuses.has(status))) {
    response.status(400).json({ error: "q is required (up to 500 characters); status must be a valid email job status when provided." });
    return;
  }
  const page = Math.max(1, Number.parseInt(String(request.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(request.query.pageSize ?? "20"), 10) || 20));
  if ((page - 1) * pageSize >= 10_000) {
    response.status(400).json({ error: "Requested page exceeds the Elasticsearch result window." });
    return;
  }
  try {
    response.json(await searchEmails({ userId: response.locals.userId as string, q, status, page, pageSize }));
  } catch {
    response.status(503).json({ error: "Email search is temporarily unavailable." });
  }
});

emailRouter.get("/emails/:id", async (request, response) => {
  const job = await prisma.emailJob.findFirst({
    where: { id: request.params.id, campaign: { userId: response.locals.userId as string } },
    select: { id: true, recipientEmail: true, subject: true, body: true, scheduledAt: true, sentAt: true, status: true, attempts: true, lastError: true, providerMessageId: true, createdAt: true, updatedAt: true },
  });
  if (!job) {
    response.status(404).json({ error: "Email job not found." });
    return;
  }
  response.json(job);
});
