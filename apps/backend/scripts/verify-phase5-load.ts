import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import type { Sender } from "../src/generated/prisma/client.js";
import { createProducerConnection, createWorkerConnection } from "../src/queue/connection.js";
import { createEmailDeliveryProcessor, type EmailDeliveryRecord, type EmailDeliveryStore } from "../src/queue/email-delivery.processor.js";
import { closeEmailIndexQueue } from "../src/search/email-index.queue.js";
import { claimRateAlert, reserveSenderSend } from "../src/queue/sender-rate-limiter.js";

async function main(): Promise<void> {
  const suffix = randomUUID();
  const senderId = `phase5-load-sender-${suffix}`;
  const sender = { id: senderId, email: "load-test@example.test" } as Sender;
  const ids = Array.from({ length: 1_000 }, () => randomUUID());
  const rows = new Map<string, EmailDeliveryRecord>(ids.map((id) => [id, {
    id, status: "scheduled", senderId, recipientEmail: `${id}@example.test`, subject: "mock", body: "mock", sender, campaign: { userId: "load-test-user" },
  }]));
  const attempts = new Map(ids.map((id) => [id, 0]));
  const store: EmailDeliveryStore = {
    find: async (id) => rows.get(id) ?? null,
    claim: async (id) => { const row = rows.get(id); if (!row || row.status === "sent") return false; row.status = "processing"; attempts.set(id, (attempts.get(id) ?? 0) + 1); return true; },
    status: async (id) => rows.get(id)?.status ?? null,
    markSent: async (id) => { const row = rows.get(id); if (row) row.status = "sent"; },
    markFailure: async (id) => { const row = rows.get(id); if (row) row.status = "failed"; },
  };
  const queueName = `phase5-load-${suffix}`;
  const producer = createProducerConnection();
  const queue = new Queue<{ emailJobId: string }, { accepted: true; emailJobId: string }>(queueName, { connection: producer });
  const workerConnections = Array.from({ length: 4 }, () => createWorkerConnection());
  const workers: Worker[] = [];
  try {
    await queue.addBulk(ids.map((emailJobId, index) => ({ name: "send", data: { emailJobId }, opts: { jobId: emailJobId, priority: index + 1 } })));
    let smtpCalls = 0, alertClaims = 0, rescheduled = 0;
    let signalRescheduled!: () => void;
    const allBlocked = new Promise<void>((resolve) => { signalRescheduled = resolve; });
    let signalAllowedComplete!: () => void;
    const allowedComplete = new Promise<void>((resolve) => { signalAllowedComplete = resolve; });
    const processors = workerConnections.map((redis) => createEmailDeliveryProcessor({
      redis,
      store,
      indexChanged: async () => undefined,
      reserve: (id) => reserveSenderSend(redis, id, { minDelayMs: 2_000, hourlyLimit: 1 }),
      notify: async ({ senderId: limitedSender, hourStart }) => {
        if (await claimRateAlert(redis, limitedSender, hourStart)) alertClaims += 1;
        rescheduled += 1;
        if (rescheduled === 999) signalRescheduled();
      },
      send: async () => { smtpCalls += 1; return { messageId: "mock-load-provider-id" }; },
    }));
    processors.forEach((processor, index) => {
      const worker = new Worker<{ emailJobId: string }, { accepted: true; emailJobId: string }>(queueName, processor, { connection: workerConnections[index], concurrency: 10 });
      worker.on("completed", (job) => { if (rows.get(job.data.emailJobId)?.status === "sent") signalAllowedComplete(); });
      workers.push(worker);
    });
    const failed = new Promise<never>((_resolve, reject) => {
      for (const worker of workers) worker.on("failed", (job, error) => { if (job) reject(new Error(`Load job failed (${error.name}).`)); });
    });
    await Promise.all(workers.map((worker) => worker.waitUntilReady()));
    await Promise.race([allBlocked, failed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Not all load jobs reached a rate decision.")), 60_000))]);
    await Promise.race([allowedComplete, failed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Allowed load job did not complete.")), 10_000))]);

    const counts = await queue.getJobCounts("completed", "delayed", "failed", "waiting", "active");
    const loadedRows = [...rows.values()];
    const stateCounts = {
      jobs: loadedRows.length,
      queueCompleted: counts.completed,
      queueDelayed: counts.delayed,
      queueFailed: counts.failed,
      queueWaitingOrActive: counts.waiting + counts.active,
      emailsSent: loadedRows.filter((row) => row.status === "sent").length,
      emailsScheduled: loadedRows.filter((row) => row.status === "scheduled").length,
      emailAttempts: [...attempts.values()].reduce((sum, count) => sum + count, 0),
      smtpCalls,
      alerts: alertClaims,
    };
    assert.equal(counts.completed, 1);
    assert.equal(counts.delayed, 999);
    assert.equal(counts.failed, 0);
    assert.equal(counts.waiting + counts.active, 0);
    assert.equal(stateCounts.emailsSent, 1);
    assert.equal(stateCounts.emailsScheduled, 999);
    assert.equal(stateCounts.emailAttempts, 1);
    assert.equal(smtpCalls, 1);
    assert.equal(alertClaims, 1);
    assert.equal(rows.size, 1_000);
    console.info(`Mocked 1,000-job BullMQ load result: ${JSON.stringify(stateCounts)}.`);
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
    workerConnections.forEach((connection) => connection.disconnect());
    await queue.obliterate({ force: true });
    await queue.close();
    producer.disconnect();
    await closeEmailIndexQueue();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 5 load verification failed.");
  process.exitCode = 1;
});
