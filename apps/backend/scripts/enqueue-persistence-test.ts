import { closeEmailQueue, emailQueue } from "../src/queue/email.queue.js";
import { EMAIL_DELIVERY_JOB_NAME } from "../src/queue/types.js";

async function main(): Promise<void> {
  try {
    await emailQueue.waitUntilReady();
    const delayMs = Number(process.env.PERSISTENCE_TEST_DELAY_MS ?? 30000);
    if (!Number.isInteger(delayMs) || delayMs < 5000) {
      throw new Error("PERSISTENCE_TEST_DELAY_MS must be an integer of at least 5000.");
    }
    const emailJobId = `persistence-test-${Date.now()}`;
    const job = await emailQueue.add(
      EMAIL_DELIVERY_JOB_NAME,
      { emailJobId },
      { jobId: emailJobId, delay: delayMs },
    );
    console.log(`Enqueued delayed job ${job.id}; delay ${delayMs} ms.`);
    console.log(`Inspect it with: pnpm --filter @reachinbox/backend run queue:persistence:inspect -- ${job.id}`);
  } finally {
    await closeEmailQueue();
  }
}

void main();
