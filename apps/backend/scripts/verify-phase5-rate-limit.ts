import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createWorkerConnection } from "../src/queue/connection.js";
import { claimRateAlert, reserveSenderSend } from "../src/queue/sender-rate-limiter.js";
import { notifySenderLimitUsing } from "../src/slack/notifications.js";
import { encryptCredential } from "../src/email/credentials.js";
import { EmailDeliveryLockBusyError, withEmailDeliveryLock } from "../src/queue/email-delivery-lock.js";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const redisA = createWorkerConnection(), redisB = createWorkerConnection();
  const suffix = randomUUID();
  try {
    const sender = `phase5-delay-${suffix}`;
    const gap = 2_000;
    const first = await reserveSenderSend(redisA, sender, { minDelayMs: gap, hourlyLimit: 200 });
    assert.equal(first.kind, "allow");
    const second = await reserveSenderSend(redisB, sender, { minDelayMs: gap, hourlyLimit: 200 });
    assert.equal(second.kind, "wait");
    if (second.kind !== "wait") throw new Error("Expected delay decision.");
    await pause(Math.max(0, second.retryAt - Date.now()) + 20);
    const secondAllowed = await reserveSenderSend(redisB, sender, { minDelayMs: gap, hourlyLimit: 200 });
    assert.equal(secondAllowed.kind, "allow");
    if (secondAllowed.kind !== "allow") throw new Error("Expected second allowed reservation.");
    assert(secondAllowed.reservedAt - first.reservedAt >= gap - 20);

    const sharedSender = `phase5-limit-${suffix}`;
    const concurrent = await Promise.all(Array.from({ length: 20 }, (_, i) => reserveSenderSend(i % 2 ? redisA : redisB, sharedSender, { minDelayMs: 0, hourlyLimit: 3 })));
    assert.equal(concurrent.filter((item) => item.kind === "allow").length, 3);
    assert.equal(concurrent.filter((item) => item.kind === "hourly-limit").length, 17);
    const limited = concurrent.find((item) => item.kind === "hourly-limit");
    assert(limited && limited.kind === "hourly-limit");
    assert.equal(limited.retryAt, limited.hourStart + 3_600_000);

    const senderA = `phase5-a-${suffix}`, senderB = `phase5-b-${suffix}`;
    assert.equal((await reserveSenderSend(redisA, senderA, { minDelayMs: 0, hourlyLimit: 1 })).kind, "allow");
    assert.equal((await reserveSenderSend(redisA, senderA, { minDelayMs: 0, hourlyLimit: 1 })).kind, "hourly-limit");
    assert.equal((await reserveSenderSend(redisB, senderB, { minDelayMs: 0, hourlyLimit: 1 })).kind, "allow");

    const lockedEmailJob = `phase5-lock-${suffix}`;
    let releaseOwner!: () => void, signalOwner!: () => void;
    const ownerGate = new Promise<void>((resolve) => { releaseOwner = resolve; });
    const ownerEntered = new Promise<void>((resolve) => { signalOwner = resolve; });
    const lockOwner = withEmailDeliveryLock(redisA, lockedEmailJob, 5_000, async () => { signalOwner(); await ownerGate; });
    await ownerEntered;
    await assert.rejects(withEmailDeliveryLock(redisB, lockedEmailJob, 5_000, async () => undefined), (error: unknown) => error instanceof EmailDeliveryLockBusyError);
    releaseOwner();
    await lockOwner;

    const alertSender = `phase5-alert-${suffix}`;
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const claims = await Promise.all(Array.from({ length: 30 }, (_, i) => claimRateAlert(i % 2 ? redisA : redisB, alertSender, hour)));
    assert.equal(claims.filter(Boolean).length, 1);

    let mode: "connected" | "disconnected" | "missing" = "connected";
    let posts = 0;
    const integration = { webhookUrlEncrypted: encryptCredential("https://hooks.slack.test/mock"), disconnectedAt: null as Date | null };
    const notify = (hourStart: number) => notifySenderLimitUsing(redisA, { senderId: alertSender, userId: "mock-user", senderEmail: "sender@example.test", limit: 3, hourStart }, {
      load: async () => mode === "missing" ? null : { ...integration, disconnectedAt: mode === "disconnected" ? new Date() : null },
      post: async () => { posts += 1; return { ok: true, status: 200 }; },
    });
    await notify(hour + 10);
    assert.equal(posts, 1, "connected integration sends one webhook request");
    mode = "disconnected";
    await notify(hour + 20);
    assert.equal(posts, 1, "disconnected integration is skipped");
    mode = "connected";
    await notify(hour + 30);
    assert.equal(posts, 2, "reconnected integration sends without process restart");
    mode = "missing";
    await notify(hour + 40);
    assert.equal(posts, 2, "missing integration is skipped safely");

    const loadSender = `phase5-load-${suffix}`;
    const load = await Promise.all(Array.from({ length: 1_000 }, (_, i) => reserveSenderSend(i % 2 ? redisA : redisB, loadSender, { minDelayMs: 2_000, hourlyLimit: 200 })));
    assert.equal(load.filter((item) => item.kind === "allow").length, 1);
    assert.equal(load.filter((item) => item.kind === "wait").length, 999);
    assert.equal(load.some((item) => item.kind === "hourly-limit"), false);

    console.info("Minimum gap: separate Redis connections reserved sends at least 2 seconds apart.");
    console.info("Hourly limit: 3/20 concurrent reservations allowed; remaining decisions point to the next UTC hour.");
    console.info("Sender isolation: filling one sender does not block another.");
    console.info("Delivery exclusion: a second Redis connection could not enter the same EmailJob lock while its owner held it.");
    console.info("Multi-connection coordination: verified with two independent worker connections.");
    console.info("Slack alert claim: exactly one of 30 concurrent sender/hour claims succeeded.");
    console.info("Slack mock lifecycle: connected and reconnected each posted; disconnected and missing integrations were skipped.");
    console.info("Representative load: 1,000 concurrent reservations yielded 1 allow and 999 retryable waits; none were dropped.");
  } finally {
    redisA.disconnect();
    redisB.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Phase 5 Redis verification failed.");
  process.exitCode = 1;
});
