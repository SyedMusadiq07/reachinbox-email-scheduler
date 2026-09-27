import { Worker } from "bullmq";
import { createWorkerConnection } from "../queue/connection.js";
import { indexEmailJob } from "./email-index.processor.js";
import { EMAIL_INDEX_QUEUE_NAME, type EmailIndexJobData } from "./email-index.queue.js";

const connection = createWorkerConnection();
const concurrency = Number.parseInt(process.env.SEARCH_INDEX_WORKER_CONCURRENCY ?? "5", 10);
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("SEARCH_INDEX_WORKER_CONCURRENCY must be a positive integer.");

export const emailIndexWorker = new Worker<EmailIndexJobData>(EMAIL_INDEX_QUEUE_NAME, (job) => indexEmailJob(job.data.emailJobId), {
  connection,
  concurrency,
});

export async function closeEmailIndexWorker(): Promise<void> {
  await emailIndexWorker.close();
  if (connection.status === "ready") await connection.quit();
  else if (connection.status !== "end") connection.disconnect();
}
