import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import type { Sender } from "../src/generated/prisma/client.js";
import { createProducerConnection, createWorkerConnection } from "../src/queue/connection.js";
import { createEmailDeliveryProcessor, type EmailDeliveryRecord, type EmailDeliveryStore } from "../src/queue/email-delivery.processor.js";
import { closeEmailIndexQueue } from "../src/search/email-index.queue.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const sender = { id: "verification-sender", email: "sender@example.test" } as Sender;

async function runOne(run: number): Promise<void> {
  const queueName = `phase5-reschedule-${randomUUID()}`;
  const producer = createProducerConnection();
  const workerRedis = createWorkerConnection();
  const queue = new Queue<{ emailJobId: string }, { accepted: true; emailJobId: string }>(queueName, { connection: producer });
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const byId = new Map<string, EmailDeliveryRecord>(ids.map((id) => [id, {
    id, status: id === ids[2] ? "sent" : "scheduled", senderId: sender.id, recipientEmail: `${id}@example.test`, subject: "test", body: "mock",
    sender, campaign: { userId: `user-${run}` },
  }]));
  const attempts = new Map(ids.map((id) => [id, id === ids[2] ? 1 : 0]));
  const store: EmailDeliveryStore = {
    find: async (id) => byId.get(id) ?? null,
    claim: async (id) => {
      const row = byId.get(id);
      if (!row || row.status === "sent") return false;
      row.status = "processing";
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      return true;
    },
    status: async (id) => byId.get(id)?.status ?? null,
    markSent: async (id) => { const row = byId.get(id); if (row) row.status = "sent"; },
    markFailure: async (id, finalAttempt) => { const row = byId.get(id); if (row) row.status = finalAttempt ? "failed" : "processing"; },
  };
  let worker: Worker | undefined;
  try {
    await queue.addBulk(ids.map((emailJobId, sequenceNumber) => ({ name: "send", data: { emailJobId }, opts: { jobId: emailJobId, priority: sequenceNumber + 1 } })));
    let reservations = 0, smtpCalls = 0, notifications = 0;
    let signalTwoBlocked!: () => void;
    const twoBlocked = new Promise<void>((resolve) => { signalTwoBlocked = resolve; });
    let signalRetryCompleted!: () => void;
    const retryCompleted = new Promise<void>((resolve) => { signalRetryCompleted = resolve; });
    let signalSentReplayCompleted!: () => void;
    const sentReplayCompleted = new Promise<void>((resolve) => { signalSentReplayCompleted = resolve; });
    worker = new Worker<{ emailJobId: string }, { accepted: true; emailJobId: string }>(queueName, createEmailDeliveryProcessor({
      redis: workerRedis,
      store,
      indexChanged: async () => undefined,
      reserve: async () => {
        reservations += 1;
        if (reservations === 1) return { kind: "wait", retryAt: Date.now() + 5_000, hourStart: Date.now() };
        if (reservations === 2) { signalTwoBlocked(); return { kind: "hourly-limit", retryAt: Date.now() + 60_000, hourStart: Date.now() }; }
        if (reservations === 3) { signalTwoBlocked(); return { kind: "allow", reservedAt: Date.now(), hourStart: Date.now() }; }
        throw new Error("Unexpected extra reservation.");
      },
      notify: async () => { notifications += 1; },
      send: async (_selectedSender, _recipient, _subject, _body) => { smtpCalls += 1; return { messageId: `<mock-${ids[0]}@example.test>` }; },
    }), { connection: workerRedis, concurrency: 1 });
    const failed = new Promise<never>((_resolve, reject) => worker!.on("failed", (job, error) => {
      if (job && ids.includes(job.data.emailJobId)) reject(new Error(`Unexpected worker failure (${error.name}).`));
    }));
    worker.on("completed", (job) => {
      if (job.data.emailJobId === ids[0]) signalRetryCompleted();
      if (job.data.emailJobId === ids[2]) signalSentReplayCompleted();
    });
    await worker.waitUntilReady();
    await Promise.race([Promise.all([twoBlocked, sentReplayCompleted]), failed, pause(15_000).then(() => { throw new Error("Worker did not process the blocked jobs and sent replay."); })]);
    await pause(100);
    const firstQueueJob = await queue.getJob(ids[0]);
    const secondQueueJob = await queue.getJob(ids[1]);
    const replayQueueJob = await queue.getJob(ids[2]);
    assert(firstQueueJob && secondQueueJob && replayQueueJob);
    assert.equal(await firstQueueJob.getState(), "delayed");
    assert.equal(await secondQueueJob.getState(), "delayed");
    assert.equal(await replayQueueJob.getState(), "completed");
    assert.equal(smtpCalls, 0);
    assert.equal(notifications, 1);
    assert.equal(attempts.get(ids[0]), 0);
    assert.equal(attempts.get(ids[1]), 0);
    assert.equal(attempts.get(ids[2]), 1, "sent replay must not increment attempts");
    assert.equal(byId.get(ids[0])?.status, "scheduled");
    assert.equal(byId.get(ids[1])?.status, "scheduled");
    assert.equal(byId.get(ids[2])?.status, "sent");

    await Promise.race([retryCompleted, failed, pause(10_000).then(() => { throw new Error("WAIT job did not become eligible again."); })]);
    assert.equal(await firstQueueJob.getState(), "completed");
    assert.equal(await secondQueueJob.getState(), "delayed");
    assert.equal(reservations, 3);
    assert.equal(smtpCalls, 1);
    assert.equal(attempts.get(ids[0]), 1);
    assert.equal(attempts.get(ids[1]), 0);
    assert.equal(byId.get(ids[0])?.status, "sent");
    assert.equal(byId.get(ids[1])?.status, "scheduled");
    assert.equal(byId.size, 3, "delayed retries retain the original logical jobs");
    console.info(`Real Worker reschedule repeat ${run}: WAIT/hourly jobs delayed and reused original IDs; later WAIT send completed; sent replay skipped SMTP; SMTP=${smtpCalls}, attempts=${attempts.get(ids[0])}/${attempts.get(ids[1])}/${attempts.get(ids[2])}, permanent failures=0.`);
  } finally {
    if (worker) await worker.close();
    workerRedis.disconnect();
    for (const id of ids) {
      const job = await queue.getJob(id);
      if (job) await job.remove();
    }
    await queue.close();
    producer.disconnect();
  }
}

async function main(): Promise<void> {
  for (let run = 1; run <= 5; run += 1) await runOne(run);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 5 real-worker rescheduling verification failed.");
  process.exitCode = 1;
}).finally(async () => {
  await closeEmailIndexQueue();
});
