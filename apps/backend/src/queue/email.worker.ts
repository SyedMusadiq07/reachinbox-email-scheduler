import { Worker } from "bullmq";
import { prisma } from "../db/prisma.js";
import { createWorkerConnection, getWorkerConcurrency } from "./connection.js";
import { createEmailDeliveryProcessor } from "./email-delivery.processor.js";
import { closeEmailIndexWorker } from "../search/email-index.worker.js";
import { closeElasticsearchClient } from "../search/elasticsearch.js";
import {
  EMAIL_QUEUE_NAME,
  type EmailDeliveryJobData,
  type EmailDeliveryJobResult,
} from "./types.js";

const workerConnection = createWorkerConnection();

export const emailWorker = new Worker<EmailDeliveryJobData, EmailDeliveryJobResult>(
    EMAIL_QUEUE_NAME,
    createEmailDeliveryProcessor({ redis: workerConnection }),
    {
      connection: workerConnection,
      concurrency: getWorkerConcurrency(),
    },
);

export async function closeEmailWorker(): Promise<void> {
  await emailWorker.close();
  await closeEmailIndexWorker();
  await closeElasticsearchClient();
  await prisma.$disconnect();
  if (workerConnection.status === "ready") {
    await workerConnection.quit();
  } else if (workerConnection.status !== "end") {
    workerConnection.disconnect();
  }
}
