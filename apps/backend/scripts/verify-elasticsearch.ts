import "dotenv/config";
import { randomUUID } from "node:crypto";
import { closeElasticsearchClient, EMAIL_SEARCH_INDEX, ensureEmailSearchIndex, getElasticsearchClient, verifyElasticsearchConnection } from "../src/search/elasticsearch.js";
import { indexEmailJob, indexEmailJobs } from "../src/search/email-index.processor.js";
import { searchEmails } from "../src/search/email-search.js";
import { createEmailDeliveryProcessor, type EmailDeliveryRecord, type EmailDeliveryStore } from "../src/queue/email-delivery.processor.js";
import { createWorkerConnection } from "../src/queue/connection.js";
import type { Sender } from "../src/generated/prisma/client.js";
import { prisma } from "../src/db/prisma.js";
import { closeEmailIndexQueue } from "../src/search/email-index.queue.js";
import { closeEmailQueue } from "../src/queue/email.queue.js";
import { Worker, QueueEvents } from "bullmq";
import { EMAIL_INDEX_QUEUE_NAME, emailIndexQueue } from "../src/search/email-index.queue.js";
import express from "express";
import { emailRouter } from "../src/routes/email.routes.js";

let verificationPhase = "Elasticsearch startup";

async function retryTransient<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function verifyWorkerStatusIndexing(testRun: string): Promise<void> {
  verificationPhase = "create temporary verification user";
  const googleId = `phase6-verify-${testRun}`;
  let ownerId: string | undefined;
  let senderId: string | undefined;
  let campaignId: string | undefined;
  const emailJobIds: string[] = [];
  const restartBullJobId = `phase6-restart-${testRun}`;
  const redis = createWorkerConnection();
  try {
    const owner = await retryTransient(() => prisma.user.upsert({
      where: { googleId },
      create: { googleId, name: "Phase 6 verification", email: `phase6-${testRun}@example.test` },
      update: {},
    }));
    ownerId = owner.id;
    verificationPhase = "create temporary verification sender";
    const sender = await retryTransient(() => prisma.sender.upsert({
      where: { userId_email: { userId: owner.id, email: `sender-${testRun}@example.test` } },
      create: {
        userId: owner.id, email: `sender-${testRun}@example.test`, displayName: "Verification sender",
        smtpHost: "localhost", smtpPort: 2525, smtpUsernameEncrypted: "test-ciphertext", smtpPasswordEncrypted: "test-ciphertext",
      },
      update: {},
    }));
    senderId = sender.id;
    verificationPhase = "create temporary verification campaign";
    const idempotencyKey = `phase6-${testRun}`;
    const campaign = await retryTransient(() => prisma.campaign.upsert({
      where: { userId_idempotencyKey: { userId: owner.id, idempotencyKey } },
      create: {
        userId: owner.id, senderId: sender.id, subject: `WorkerStatus ${testRun}`, body: "Mock body",
        startTime: new Date(), delayMs: 0, hourlyLimit: 20, idempotencyKey,
      },
      update: {},
    }));
    campaignId = campaign.id;
    verificationPhase = "create temporary EmailJobs and index scheduled state";
    for (const [sequenceNumber, outcome] of ["sent", "failed"].entries()) {
      const job = await retryTransient(() => prisma.emailJob.upsert({
        where: { campaignId_sequenceNumber: { campaignId: campaign.id, sequenceNumber } },
        create: {
          campaignId: campaign.id, senderId: sender.id, recipientEmail: `${outcome}-${testRun}@example.test`,
          subject: `WorkerStatus ${outcome}`, body: `Mock ${outcome} body`, sequenceNumber, scheduledAt: new Date(),
        },
        update: {},
      }));
      emailJobIds.push(job.id);
      await retryTransient(() => indexEmailJob(job.id));
    }
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    const [sentJobId, failedJobId] = emailJobIds;
    const sentRecipient = `sent-${testRun}@example.test`;
    const initial = await searchEmails({ userId: owner.id, q: sentRecipient, status: "scheduled", page: 1, pageSize: 10 });
    if (initial.total !== 1) throw new Error("Scheduled EmailJob state was not indexed.");

    verificationPhase = "worker processing and sent transitions";
    const sentProcessor = createEmailDeliveryProcessor({
      redis, ttlMs: 10_000, reserve: async () => ({ kind: "allow", reservedAt: Date.now(), hourStart: Date.now() }),
      indexChanged: async () => undefined,
      send: async () => {
        await indexEmailJob(sentJobId!);
        await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
        const processing = await searchEmails({ userId: owner.id, q: sentRecipient, status: "processing", page: 1, pageSize: 10 });
        if (processing.total !== 1) throw new Error("Processing EmailJob state was not indexed.");
        return { messageId: "mock-provider-id" };
      },
    });
    const makeBullJob = (emailJobId: string) => ({ id: emailJobId, data: { emailJobId }, attemptsMade: 0, opts: { attempts: 1 }, moveToDelayed: async () => undefined }) as Parameters<typeof sentProcessor>[0];
    await sentProcessor(makeBullJob(sentJobId!));
    await indexEmailJob(sentJobId!);
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    const sent = await searchEmails({ userId: owner.id, q: sentRecipient, status: "sent", page: 1, pageSize: 10 });
    if (sent.total !== 1) throw new Error("Sent EmailJob state was not indexed.");

    verificationPhase = "bulk reindex repair from PostgreSQL";
    await getElasticsearchClient().delete({ index: EMAIL_SEARCH_INDEX, id: sentJobId! });
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    const missing = await searchEmails({ userId: owner.id, q: sentRecipient, status: "sent", page: 1, pageSize: 10 });
    if (missing.total !== 0) throw new Error("Test could not remove a missing document before reindex repair.");
    const durableRecord = await retryTransient(() => prisma.emailJob.findUnique({
      where: { id: sentJobId! }, include: { campaign: { select: { userId: true } } },
    }));
    if (!durableRecord) throw new Error("PostgreSQL EmailJob for the reindex repair is missing.");
    await retryTransient(() => indexEmailJobs([durableRecord]));
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    const repaired = await searchEmails({ userId: owner.id, q: sentRecipient, status: "sent", page: 1, pageSize: 10 });
    if (repaired.total !== 1) throw new Error("Bulk reindex did not repair a missing Elasticsearch document.");

    verificationPhase = "worker failure transition";
    const failedProcessor = createEmailDeliveryProcessor({
      redis, ttlMs: 10_000, reserve: async () => ({ kind: "allow", reservedAt: Date.now(), hourStart: Date.now() }),
      indexChanged: async () => undefined,
      send: async () => {
        await indexEmailJob(failedJobId!);
        throw new Error("mock SMTP failure");
      },
    });
    await failedProcessor(makeBullJob(failedJobId!)).then(() => { throw new Error("Mock failure was unexpectedly accepted."); }, () => undefined);
    await indexEmailJob(failedJobId!);
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    const failed = await searchEmails({ userId: owner.id, q: `WorkerStatus failed`, status: "failed", page: 1, pageSize: 10 });
    if (failed.total !== 1) throw new Error("Failed EmailJob state was not indexed.");

    verificationPhase = "email-index queue worker restart recovery";
    const restartJob = await emailIndexQueue.add("index-email", { emailJobId: sentJobId! }, {
      jobId: restartBullJobId, delay: 5000, removeOnComplete: false,
    });
    const eventsConnection = createWorkerConnection();
    const queueEvents = new QueueEvents(EMAIL_INDEX_QUEUE_NAME, { connection: eventsConnection });
    let firstConnection: ReturnType<typeof createWorkerConnection> | undefined = createWorkerConnection();
    let firstWorker: Worker | undefined = new Worker(EMAIL_INDEX_QUEUE_NAME, (job) => indexEmailJob(job.data.emailJobId), { connection: firstConnection, concurrency: 1 });
    let secondConnection: ReturnType<typeof createWorkerConnection> | undefined;
    let secondWorker: Worker | undefined;
    try {
      await queueEvents.waitUntilReady();
      const completed = restartJob.waitUntilFinished(queueEvents, 20_000);
      await firstWorker.waitUntilReady();
      await firstWorker.close();
      firstWorker = undefined;
      firstConnection.disconnect();
      firstConnection = undefined;
      if (await restartJob.getState() !== "delayed") throw new Error("The index job did not remain delayed after the first worker stopped.");
      secondConnection = createWorkerConnection();
      secondWorker = new Worker(EMAIL_INDEX_QUEUE_NAME, (job) => indexEmailJob(job.data.emailJobId), { connection: secondConnection, concurrency: 1 });
      await secondWorker.waitUntilReady();
      await completed;
      if (await restartJob.getState() !== "completed") throw new Error("The index job did not complete after worker restart.");
    } finally {
      if (firstWorker) await firstWorker.close().catch(() => undefined);
      if (firstConnection) firstConnection.disconnect();
      if (secondWorker) await secondWorker.close().catch(() => undefined);
      if (secondConnection) secondConnection.disconnect();
      await queueEvents.close();
      eventsConnection.disconnect();
    }
    await restartJob.remove().catch(() => undefined);
  } finally {
    const leftoverRestartJob = await emailIndexQueue.getJob(restartBullJobId);
    await leftoverRestartJob?.remove().catch(() => undefined);
    if (emailJobIds.length) await getElasticsearchClient().delete({ index: EMAIL_SEARCH_INDEX, id: emailJobIds[0]! }).catch(() => undefined);
    if (emailJobIds.length > 1) await getElasticsearchClient().delete({ index: EMAIL_SEARCH_INDEX, id: emailJobIds[1]! }).catch(() => undefined);
    if (campaignId) await prisma.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
    if (senderId) await prisma.sender.delete({ where: { id: senderId } }).catch(() => undefined);
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } }).catch(() => undefined);
    else {
      const partialOwner = await prisma.user.findUnique({ where: { googleId }, select: { id: true } }).catch(() => null);
      if (partialOwner) await prisma.user.delete({ where: { id: partialOwner.id } }).catch(() => undefined);
    }
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  const testRun = randomUUID();
  const userA = `verify-user-a-${testRun}`;
  const userB = `verify-user-b-${testRun}`;
  const firstId = `verify-email-a-${testRun}`;
  const secondId = `verify-email-b-${testRun}`;
  const otherTenantId = `verify-email-other-${testRun}`;
  const scheduledAt = new Date();
  const makeRecord = (id: string, userId: string, status: string, recipientEmail: string, suffix: string) => ({
    id, campaignId: `campaign-${userId}`, senderId: `sender-${userId}`, recipientEmail,
    subject: `Phase6Search ${testRun} ${suffix}`, body: `DistinctiveBody ${testRun} ${suffix} ${suffix === "one" ? "quasaralpha" : "heliumbeta"}`,
    status, scheduledAt, sentAt: status === "sent" ? new Date() : null,
    updatedAt: new Date(), campaign: { userId },
  });

  try {
    await verifyElasticsearchConnection();
    await ensureEmailSearchIndex();
    await ensureEmailSearchIndex();
    const mapping = await getElasticsearchClient().indices.getMapping({ index: EMAIL_SEARCH_INDEX });
    if (!mapping[EMAIL_SEARCH_INDEX]?.mappings?.properties?.body) throw new Error("emails index mapping is missing body.");

    const first = makeRecord(firstId, userA, "scheduled", `phase6-${testRun}@example.test`, "one");
    const second = makeRecord(secondId, userA, "sent", `phase6-second-${testRun}@example.test`, "two");
    const privateRecord = makeRecord(otherTenantId, userB, "sent", `phase6-private-${testRun}@example.test`, "one");
    await indexEmailJobs([first, second, privateRecord]);
    await indexEmailJobs([first, second, privateRecord]);
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });

    verificationPhase = "exact recipient search";
    const byRecipient = await searchEmails({ userId: userA, q: first.recipientEmail, page: 1, pageSize: 10 });
    if (byRecipient.total !== 1 || byRecipient.items[0]?.id !== firstId) throw new Error(`recipient email search or tenant isolation failed (total=${byRecipient.total}, ids=${byRecipient.items.map((item) => item.id).join(",")}).`);
    verificationPhase = "subject search and pagination";
    const bySubject = await searchEmails({ userId: userA, q: `Phase6Search ${testRun}`, page: 1, pageSize: 1 });
    if (bySubject.total !== 2 || bySubject.items.length !== 1) throw new Error("subject search or pagination failed.");
    verificationPhase = "body search";
    const byBody = await searchEmails({ userId: userA, q: "quasaralpha", page: 1, pageSize: 10 });
    if (byBody.total !== 1 || byBody.items[0]?.id !== firstId) throw new Error("body search failed.");
    verificationPhase = "status filter";
    const filtered = await searchEmails({ userId: userA, q: `Phase6Search ${testRun}`, status: "sent", page: 1, pageSize: 10 });
    if (filtered.total !== 1 || filtered.items[0]?.id !== secondId) throw new Error("status filter failed.");
    verificationPhase = "tenant isolation";
    const hidden = await searchEmails({ userId: userA, q: `phase6-private-${testRun}@example.test`, page: 1, pageSize: 10 });
    if (hidden.total !== 0) throw new Error("tenant isolation failed.");

    const updated = { ...first, status: "sent", sentAt: new Date(), updatedAt: new Date(first.updatedAt.getTime() + 5000) };
    await indexEmailJobs([updated]);
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    const updatedStatus = await searchEmails({ userId: userA, q: first.recipientEmail, status: "sent", page: 1, pageSize: 10 });
    if (updatedStatus.total !== 1 || updatedStatus.items[0]?.status !== "sent") throw new Error("status update and idempotent index update failed.");

    await verifyWorkerStatusIndexing(testRun);

    const localUser = await prisma.user.findUnique({ where: { googleId: "local-development-only" }, select: { id: true } });
    if (!localUser) throw new Error("The development user must be seeded to verify the HTTP search route.");
    const apiId = `verify-email-api-${testRun}`;
    const apiRecord = makeRecord(apiId, localUser.id, "scheduled", `phase6-http-${testRun}@example.test`, "api");
    await indexEmailJobs([apiRecord]);
    await getElasticsearchClient().indices.refresh({ index: EMAIL_SEARCH_INDEX });
    verificationPhase = "HTTP search endpoint";
    const api = express();
    api.use(express.json());
    api.use("/api", (_request, response, next) => { response.locals.userId = localUser.id; next(); }, emailRouter);
    const server = api.listen(0);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Could not read the temporary API port.");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/emails/search?q=${encodeURIComponent(apiRecord.recipientEmail)}&page=1&pageSize=5`);
      const payload = await response.json() as { items?: Array<Record<string, unknown>>; total?: number };
      const apiItem = payload.items?.[0];
      if (!response.ok || payload.total !== 1 || apiItem?.id !== apiId || "body" in apiItem || "userId" in apiItem) {
        throw new Error("The authenticated HTTP search route returned an invalid or unsafe result.");
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    // Keep Elasticsearch unavailable in this process while running a delivery with mocked SMTP.
    verificationPhase = "mocked SMTP with index queue outage";
    await closeElasticsearchClient();
    const originalElasticsearchUrl = process.env.ELASTICSEARCH_URL;
    process.env.ELASTICSEARCH_URL = "http://127.0.0.1:1";
    const redis = createWorkerConnection();
    const outageRecord: EmailDeliveryRecord = {
      id: `verify-outage-${testRun}`, status: "scheduled", senderId: "verify-sender",
      recipientEmail: `outage-${testRun}@example.test`, subject: "Mock delivery", body: "Mock body",
      sender: {} as Sender, campaign: { userId: userA },
    };
    let mockSendCount = 0;
    const store: EmailDeliveryStore = {
      find: async () => outageRecord,
      claim: async () => true,
      status: async () => outageRecord.status,
      markSent: async () => { outageRecord.status = "sent"; },
      markFailure: async () => { outageRecord.status = "failed"; },
    };
    try {
      const deliver = createEmailDeliveryProcessor({
        redis, ttlMs: 10_000, store, reserve: async () => ({ kind: "allow", reservedAt: Date.now(), hourStart: Date.now() }),
        send: async () => { mockSendCount += 1; return { messageId: "mock-provider-id" }; },
        indexChanged: async () => { throw new Error("simulated unavailable indexing queue"); },
      });
      const fakeJob = { id: "verify", data: { emailJobId: outageRecord.id }, attemptsMade: 0, opts: { attempts: 1 }, moveToDelayed: async () => undefined } as Parameters<typeof deliver>[0];
      const deliveryResult = await deliver(fakeJob);
      if (!deliveryResult.accepted || mockSendCount !== 1 || outageRecord.status !== "sent") throw new Error("Elasticsearch outage interfered with email delivery.");
    } finally {
      if (originalElasticsearchUrl === undefined) delete process.env.ELASTICSEARCH_URL;
      else process.env.ELASTICSEARCH_URL = originalElasticsearchUrl;
      redis.disconnect();
    }

    console.log("Elasticsearch verification passed: health, non-destructive idempotent initialization, mapping, repeated indexing, recipient/subject/body search, tenant isolation, status filtering/update, pagination, and mocked SMTP delivery while Elasticsearch was unavailable.");
  } finally {
    await getElasticsearchClient().deleteByQuery({ index: EMAIL_SEARCH_INDEX, query: { terms: { _id: [firstId, secondId, otherTenantId, `verify-email-api-${testRun}`] } }, refresh: true }).catch(() => undefined);
    await closeElasticsearchClient();
    await closeEmailQueue();
    await closeEmailIndexQueue();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
    const errorName = typeof error === "object" && error !== null ? error.constructor?.name : typeof error;
    console.error(`Elasticsearch verification failed during ${verificationPhase}: ${error instanceof Error ? error.message : `non-Error (${errorName ?? "unknown"})`}`);
  process.exit(1);
}).then(() => {
  process.exit(0);
});
