import { Queue } from "bullmq";
import { createProducerConnection } from "./connection.js";
import {
  EMAIL_QUEUE_NAME,
  type EmailDeliveryJobData,
  type EmailDeliveryJobResult,
} from "./types.js";

const producerConnection = createProducerConnection();

export const emailQueue = new Queue<EmailDeliveryJobData, EmailDeliveryJobResult>(EMAIL_QUEUE_NAME, {
  connection: producerConnection,
  defaultJobOptions: {
    attempts: Number.parseInt(process.env.EMAIL_JOB_ATTEMPTS ?? "3", 10),
    backoff: { type: "exponential", delay: Number.parseInt(process.env.EMAIL_RETRY_BACKOFF_MS ?? "5000", 10) },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
  if (producerConnection.status === "ready") {
    await producerConnection.quit();
  } else if (producerConnection.status !== "end") {
    producerConnection.disconnect();
  }
}
