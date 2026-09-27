import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { prisma } from "../src/db/prisma.js";
import { closeEmailQueue, emailQueue } from "../src/queue/email.queue.js";
import { createWorkerConnection } from "../src/queue/connection.js";
import { createEmailDeliveryProcessor } from "../src/queue/email-delivery.processor.js";
import { closeEmailIndexQueue } from "../src/search/email-index.queue.js";
import { EMAIL_DELIVERY_JOB_NAME, EMAIL_QUEUE_NAME } from "../src/queue/types.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  let stage = "load development records";
  const user = await prisma.user.findUnique({ where: { googleId: "local-development-only" } });
  if (!user) throw new Error("Run the development seed first.");
  const sender = await prisma.sender.findFirst({ where: { userId: user.id, active: true } });
  if (!sender) throw new Error("An active development sender is required.");
  const campaign = await prisma.campaign.create({ data: {
    userId: user.id, senderId: sender.id, subject: "Phase 5 restart verification", body: "Mocked SMTP only.",
    startTime: new Date(Date.now() + 5_000), delayMs: 0, hourlyLimit: 200,
    idempotencyKey: `phase5-restart-${randomUUID()}`,
    emailJobs: { create: { id: randomUUID(), recipientEmail: "phase5-restart@example.test", subject: "restart", body: "mock", sequenceNumber: 0, scheduledAt: new Date(Date.now() + 5_000), senderId: sender.id } },
  }, include: { emailJobs: true } });
  const record = campaign.emailJobs[0];
  const queueJobId = record.bullJobId ?? record.id;
  let worker: Worker | undefined;
  let workerRedis = createWorkerConnection();
  try {
    stage = "enqueue future job";
    await emailQueue.add(EMAIL_DELIVERY_JOB_NAME, { emailJobId: record.id }, { jobId: queueJobId, delay: 5_000, priority: 1 });
    worker = new Worker(EMAIL_QUEUE_NAME, async () => ({ accepted: true, emailJobId: record.id }), { connection: workerRedis, concurrency: 1 });
    await worker.waitUntilReady();
    stage = "stop first worker";
    await worker.close();
    worker = undefined;
    workerRedis.disconnect();
    await wait(5_500);

    stage = "start replacement worker";
    workerRedis = createWorkerConnection();
    worker = new Worker(EMAIL_QUEUE_NAME, createEmailDeliveryProcessor({
      redis: workerRedis,
      reserve: async () => ({ kind: "allow", reservedAt: Date.now(), hourStart: Math.floor(Date.now() / 3_600_000) * 3_600_000 }),
      indexChanged: async () => undefined,
      notify: async () => undefined,
      send: async () => ({ messageId: `<phase5-mock-${record.id}@example.test>` }),
    }), { connection: workerRedis, concurrency: 1 });
    const completed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Restarted worker did not recover the delayed job.")), 30_000);
      worker!.on("completed", (job) => {
        if (job.id === queueJobId) { clearTimeout(timer); resolve(); }
      });
    });
    await worker.waitUntilReady();
    stage = "wait for recovered job";
    await completed;
    stage = "verify persisted completion";
    const state = await (await emailQueue.getJob(queueJobId))?.getState();
    const persisted = await prisma.emailJob.findUnique({ where: { id: record.id } });
    assert.equal(state, "completed");
    assert.equal(persisted?.status, "sent");
    console.info("Restart recovery: a delayed BullMQ job survived worker shutdown and completed after a new worker started; SMTP was mocked.");
    stage = "cleanup";
  } catch {
    throw new Error(`Restart verification failed during: ${stage}.`);
  } finally {
    if (worker) await worker.close();
    workerRedis.disconnect();
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await closeEmailQueue();
    await closeEmailIndexQueue();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 5 restart verification failed.");
  process.exitCode = 1;
});
