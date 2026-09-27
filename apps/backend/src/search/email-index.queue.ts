import { Queue } from "bullmq";
import { createProducerConnection } from "../queue/connection.js";

export const EMAIL_INDEX_QUEUE_NAME = "email-index";
export interface EmailIndexJobData { emailJobId: string; }
const connection = createProducerConnection();

export const emailIndexQueue = new Queue<EmailIndexJobData>(EMAIL_INDEX_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 8,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: true,
    removeOnFail: { count: 1000 },
  },
});

export async function enqueueEmailIndex(emailJobId: string, revision: string): Promise<void> {
  try {
    await emailIndexQueue.add("index-email", { emailJobId }, { jobId: `email-index-${emailJobId}-${revision}` });
  } catch (error) {
    console.error(`Could not enqueue search indexing for EmailJob ${emailJobId}: ${error instanceof Error ? error.message : "queue error"}`);
  }
}

export async function enqueueEmailIndexes(emailJobIds: string[], revision: string): Promise<void> {
  if (emailJobIds.length === 0) return;
  try {
    await emailIndexQueue.addBulk(emailJobIds.map((emailJobId, index) => ({
      name: "index-email",
      data: { emailJobId },
      opts: { jobId: `email-index-${emailJobId}-${revision}-${index}` },
    })));
  } catch (error) {
    console.error(`Could not enqueue search indexing for ${emailJobIds.length} EmailJob records: ${error instanceof Error ? error.message : "queue error"}`);
  }
}

export async function closeEmailIndexQueue(): Promise<void> {
  await emailIndexQueue.close();
  if (connection.status === "ready") await connection.quit();
  else if (connection.status !== "end") connection.disconnect();
}
