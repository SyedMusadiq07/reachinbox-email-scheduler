import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DelayedError, Queue, Worker } from "bullmq";
import { createProducerConnection, createWorkerConnection } from "../src/queue/connection.js";

async function main(): Promise<void> {
  const name = `phase5-delay-${randomUUID()}`;
  const producer = createProducerConnection(), workerRedis = createWorkerConnection();
  const queue = new Queue(name, { connection: producer });
  let worker: Worker | undefined;
  const id = randomUUID();
  try {
    const job = await queue.add("verify-active-delay", {}, { jobId: id });
    let signalMoved!: () => void;
    const moved = new Promise<void>((resolve) => { signalMoved = resolve; });
    worker = new Worker(name, async (activeJob, token) => {
      assert(token, "BullMQ must supply the active worker token");
      await activeJob.moveToDelayed(Date.now() + 30_000, token);
      signalMoved();
      throw new DelayedError();
    }, { connection: workerRedis, concurrency: 1 });
    await worker.waitUntilReady();
    await Promise.race([moved, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("BullMQ did not move the active job.")), 10_000))]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await job.getState(), "delayed");
    console.info("BullMQ active-job API: moveToDelayed(timestamp, workerToken) plus DelayedError left the job in delayed state.");
  } finally {
    if (worker) await worker.close();
    workerRedis.disconnect();
    const job = await queue.getJob(id);
    if (job) await job.remove();
    await queue.close();
    producer.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "BullMQ delayed-state verification failed.");
  process.exitCode = 1;
});
