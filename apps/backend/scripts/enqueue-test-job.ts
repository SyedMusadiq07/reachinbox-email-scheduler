import { closeEmailQueue, emailQueue } from "../src/queue/email.queue.js";
import { EMAIL_DELIVERY_JOB_NAME } from "../src/queue/types.js";

async function main(): Promise<void> {
  try {
    await emailQueue.waitUntilReady();
    const emailJobId = `queue-test-${Date.now()}`;
    const job = await emailQueue.add(
      EMAIL_DELIVERY_JOB_NAME,
      { emailJobId },
      { jobId: emailJobId },
    );
    console.log(`Enqueued BullMQ job ${job.id}.`);
  } finally {
    await closeEmailQueue();
  }
}

void main();
