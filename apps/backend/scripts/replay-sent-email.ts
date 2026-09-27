import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { emailQueue } from "../src/queue/email.queue.js";
import { EMAIL_DELIVERY_JOB_NAME } from "../src/queue/types.js";

async function main(): Promise<void> {
  const emailJobId = process.argv.at(-1);
  if (!emailJobId) throw new Error("Pass a sent EmailJob ID.");
  const record = await prisma.emailJob.findUnique({ where: { id: emailJobId } });
  if (!record || record.status !== "sent") throw new Error("The requested EmailJob is not already sent.");
  const before = record.attempts;
  await emailQueue.add(EMAIL_DELIVERY_JOB_NAME, { emailJobId }, { jobId: `verification-replay-${emailJobId}` });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const after = await prisma.emailJob.findUnique({ where: { id: emailJobId } });
  if (after?.status !== "sent" || after.attempts !== before) throw new Error("Sent-job replay changed the durable email record.");
  console.info("Sent-job replay was skipped without another SMTP attempt.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Replay verification failed.");
  process.exitCode = 1;
}).finally(async () => {
  await emailQueue.close();
  await prisma.$disconnect();
});
