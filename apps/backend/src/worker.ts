import "dotenv/config";
import { closeEmailWorker, emailWorker } from "./queue/email.worker.js";
import { getWorkerConcurrency } from "./queue/connection.js";
import { emailIndexWorker } from "./search/email-index.worker.js";

let shuttingDown = false;

emailWorker.on("completed", (job) => {
  console.info(`Completed email queue job ${job.id}.`);
});
emailWorker.on("failed", (job, error) => {
  console.error(`Email queue job ${job?.id ?? "unknown"} failed: ${error.message}`);
});
emailWorker.on("error", (error) => {
  console.error(`Email worker error: ${error.message}`);
});
emailIndexWorker.on("completed", (job) => console.info(`Indexed EmailJob ${job.data.emailJobId}.`));
emailIndexWorker.on("failed", (job, error) => console.error(`Email index job ${job?.id ?? "unknown"} failed: ${error.message}`));
emailIndexWorker.on("error", (error) => console.error(`Email index worker error: ${error.message}`));

void emailWorker.waitUntilReady().then(() => {
  console.log(`Email worker ready (concurrency ${getWorkerConcurrency()}).`);
});
void emailIndexWorker.waitUntilReady().then(() => console.log("Email index worker ready."));

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing email worker.`);
  await closeEmailWorker();
  process.exitCode = 0;
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
