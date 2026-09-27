import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { emailRouter } from "../src/routes/email.routes.js";
import { prisma } from "../src/db/prisma.js";
import { closeEmailQueue } from "../src/queue/email.queue.js";
import { createWorkerConnection } from "../src/queue/connection.js";
import { createEmailDeliveryProcessor } from "../src/queue/email-delivery.processor.js";
import { closeEmailIndexQueue } from "../src/search/email-index.queue.js";
import { EmailDeliveryLockBusyError } from "../src/queue/email-delivery-lock.js";

async function main(): Promise<void> {
  const user = await prisma.user.findUnique({ where: { googleId: "local-development-only" } });
  if (!user) throw new Error("Run the development Ethereal seed first.");
  const sender = await prisma.sender.findFirst({ where: { userId: user.id, active: true } });
  if (!sender) throw new Error("An active development sender is required.");

  const campaign = await prisma.campaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: "Phase 4 lock verification",
      body: "Verification-only record.",
      startTime: new Date(),
      delayMs: 2_000,
      hourlyLimit: 10,
      idempotencyKey: `phase4-lock-verification-${randomUUID()}`,
      emailJobs: {
        create: [
          {
            id: randomUUID(),
            bullJobId: randomUUID(),
            recipientEmail: "phase4-lock-accepted@example.test",
            subject: "Concurrent lock verification",
            body: "Verification-only record.",
            sequenceNumber: 0,
            scheduledAt: new Date(),
            senderId: sender.id,
          },
          {
            id: randomUUID(),
            bullJobId: randomUUID(),
            recipientEmail: "phase4-lock-failed@example.test",
            subject: "Failed status API verification",
            body: "Verification-only record.",
            sequenceNumber: 1,
            scheduledAt: new Date(),
            status: "failed",
            senderId: sender.id,
          },
        ],
      },
    },
    include: { emailJobs: { orderBy: { sequenceNumber: "asc" } } },
  });
  let server: Server | undefined;
  const redis = createWorkerConnection();
  const secondWorkerRedis = createWorkerConnection();

  try {
    let signalEnteredSend!: () => void;
    let allowSendToFinish!: () => void;
    const sendEntered = new Promise<void>((resolve) => { signalEnteredSend = resolve; });
    const sendGate = new Promise<void>((resolve) => { allowSendToFinish = resolve; });
    let smtpCalls = 0;
    const processor = createEmailDeliveryProcessor({
      redis,
      ttlMs: 30_000,
      reserve: async () => ({ kind: "allow", reservedAt: Date.now(), hourStart: Math.floor(Date.now() / 3_600_000) * 3_600_000 }),
      indexChanged: async () => undefined,
      notify: async () => undefined,
      send: async () => {
        smtpCalls += 1;
        signalEnteredSend();
        await sendGate;
        return { messageId: `<verification-${campaign.emailJobs[0].id}@example.test>` };
      },
    });
    const overlappingProcessor = createEmailDeliveryProcessor({
      redis: secondWorkerRedis,
      ttlMs: 30_000,
      reserve: async () => ({ kind: "allow", reservedAt: Date.now(), hourStart: Math.floor(Date.now() / 3_600_000) * 3_600_000 }),
      indexChanged: async () => undefined,
      notify: async () => undefined,
      send: async () => {
        smtpCalls += 1;
        return { messageId: "<unexpected-overlap@example.test>" };
      },
    });
    const job = {
      id: campaign.emailJobs[0].bullJobId ?? campaign.emailJobs[0].id,
      data: { emailJobId: campaign.emailJobs[0].id },
      attemptsMade: 0,
      opts: { attempts: 3 },
      token: "phase4-verification-token",
    } as Parameters<typeof processor>[0];

    const firstExecution = processor(job);
    await sendEntered;
    await assert.rejects(
      overlappingProcessor({ ...job, id: `overlap-${job.id}` }),
      (error: unknown) => error instanceof EmailDeliveryLockBusyError,
    );
    const whileLocked = await prisma.emailJob.findUnique({ where: { id: campaign.emailJobs[0].id } });
    assert.equal(whileLocked?.status, "processing");
    assert.equal(whileLocked?.attempts, 1);
    allowSendToFinish();
    await firstExecution;

    const delivered = await prisma.emailJob.findUnique({ where: { id: campaign.emailJobs[0].id } });
    assert.equal(smtpCalls, 1, "only the lock owner may reach the SMTP function");
    assert.equal(delivered?.status, "sent");
    assert.equal(delivered?.attempts, 1);

    await processor(job);
    assert.equal(smtpCalls, 1, "replaying a sent job must skip SMTP");

    const api = express();
    // This isolated verification harness supplies a test principal; production routes use requireAuth.
    api.use("/api", (_request, response, next) => { response.locals.userId = user.id; next(); }, emailRouter);
    server = await new Promise<Server>((resolve) => {
      const listener = api.listen(0, () => resolve(listener));
    });
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}/api/emails`;
    const sentResponse = await fetch(`${baseUrl}?status=sent`);
    const failedResponse = await fetch(`${baseUrl}?status=failed`);
    const combinedResponse = await fetch(`${baseUrl}?status=sent%2Cfailed`);
    const invalidResponse = await fetch(`${baseUrl}?status=unknown`);
    assert.equal(sentResponse.status, 200);
    assert.equal(failedResponse.status, 200);
    assert.equal(combinedResponse.status, 200);
    assert.equal(invalidResponse.status, 400);

    const sentBody = await sentResponse.json() as { items: Array<{ id: string; status: string }> };
    const failedBody = await failedResponse.json() as { items: Array<{ id: string; status: string }> };
    const combinedBody = await combinedResponse.json() as { items: Array<{ id: string; status: string }> };
    assert(sentBody.items.some((item) => item.id === campaign.emailJobs[0].id && item.status === "sent"));
    assert(failedBody.items.some((item) => item.id === campaign.emailJobs[1].id && item.status === "failed"));
    assert(combinedBody.items.some((item) => item.id === campaign.emailJobs[0].id && item.status === "sent"));
    assert(combinedBody.items.some((item) => item.id === campaign.emailJobs[1].id && item.status === "failed"));

    console.info("Concurrency lock: one SMTP call; overlapping execution received retryable lock contention.");
    console.info("Sent replay: skipped without a second SMTP call.");
    console.info("Email status API: sent, failed, sent+failed, and invalid-status responses verified.");
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await prisma.campaign.delete({ where: { id: campaign.id } });
    redis.disconnect();
    secondWorkerRedis.disconnect();
    await closeEmailQueue();
    await closeEmailIndexQueue();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 4 verification failed.");
  process.exitCode = 1;
});
