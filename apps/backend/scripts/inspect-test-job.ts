import { closeEmailQueue, emailQueue } from "../src/queue/email.queue.js";

async function main(): Promise<void> {
  const jobId = process.argv.slice(2).find((argument) => argument !== "--");
  if (!jobId) {
    console.error("Usage: queue:persistence:inspect -- <job-id>");
    process.exitCode = 1;
    return;
  }

  try {
    await emailQueue.waitUntilReady();
    const job = await emailQueue.getJob(jobId);
    if (!job) {
      console.error(`BullMQ job ${jobId} was not found.`);
      process.exitCode = 1;
      return;
    }
    console.log(`BullMQ job ${jobId} state: ${await job.getState()}.`);
  } finally {
    await closeEmailQueue();
  }
}

void main();
