import type Redis from "ioredis";
import { prisma } from "../db/prisma.js";
import { decryptCredential } from "../email/credentials.js";
import { claimRateAlert } from "../queue/sender-rate-limiter.js";

export async function notifySenderLimit(redis: Redis, input: { senderId: string; userId: string; senderEmail: string; limit: number; hourStart: number }): Promise<void> {
  await notifySenderLimitUsing(redis, input, {
    load: async (userId) => prisma.slackIntegration.findUnique({ where: { userId } }),
    post: async (webhook, text) => fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }),
  });
}

export async function notifySenderLimitUsing(
  redis: Redis,
  input: { senderId: string; userId: string; senderEmail: string; limit: number; hourStart: number },
  dependencies: {
    load: (userId: string) => Promise<{ webhookUrlEncrypted: string; disconnectedAt: Date | null } | null>;
    post: (webhook: string, text: string) => Promise<{ ok: boolean; status: number }>;
  },
): Promise<void> {
  try {
    const integration = await dependencies.load(input.userId);
    if (!integration || integration.disconnectedAt) return;
    if (!await claimRateAlert(redis, input.senderId, input.hourStart)) return;
    const webhook = decryptCredential(integration.webhookUrlEncrypted);
    const response = await dependencies.post(webhook, `Sender ${input.senderEmail} reached its hourly limit of ${input.limit} emails. Remaining scheduled emails have been moved to the next available hour.`);
    if (!response.ok) console.warn(`Slack rate-limit notification returned HTTP ${response.status}.`);
  } catch (error) {
    console.warn(`Slack rate-limit notification was skipped: ${error instanceof Error ? error.message : "request failed"}`);
  }
}
