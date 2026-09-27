import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { encryptCredential } from "../email/credentials.js";
import { createProducerConnection } from "../queue/connection.js";
import { requireAuth } from "../auth/require-auth.js";

export const slackRouter = Router();
const redis = createProducerConnection();
const STATE_TTL = 600;
const secret = () => {
  const value = process.env.SLACK_STATE_SECRET;
  if (!value || value.length < 32) throw new Error("SLACK_STATE_SECRET must contain at least 32 characters.");
  return value;
};
const redirectUri = () => process.env.SLACK_REDIRECT_URI ?? "http://localhost:4000/api/integrations/slack/callback";
const sign = (value: string) => createHmac("sha256", secret()).update(value).digest("hex");

slackRouter.get("/auth/slack", requireAuth, async (_request, response) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  const userId = response.locals.userId as string | undefined;
  if (!clientId || !userId) { response.status(503).json({ error: "Slack OAuth is not configured." }); return; }
  const nonce = randomBytes(32).toString("hex");
  await redis.set(`slack:oauth-state:${nonce}`, userId, "EX", STATE_TTL, "NX");
  const state = `${nonce}.${sign(nonce)}`;
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "incoming-webhook");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("state", state);
  response.status(302).header("Location", url.toString()).end();
});

slackRouter.get("/integrations/slack/callback", async (request, response) => {
  try {
    const parsed = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ error: "Invalid Slack OAuth callback." }); return; }
    const [nonce, signature, extra] = parsed.data.state.split(".");
    const expected = sign(nonce ?? "");
    if (extra || !nonce || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) { response.status(400).json({ error: "Invalid Slack OAuth state." }); return; }
    const userId = await redis.getdel(`slack:oauth-state:${nonce}`);
    if (!userId) { response.status(400).json({ error: "Slack OAuth state expired or was already used." }); return; }
    const clientId = process.env.SLACK_CLIENT_ID, clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) { response.status(503).json({ error: "Slack OAuth is not configured." }); return; }
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: parsed.data.code, redirect_uri: redirectUri() }) });
    const result = await tokenResponse.json() as { ok?: boolean; error?: string; access_token?: string; team?: { id?: string; name?: string }; incoming_webhook?: { url?: string; channel_id?: string; channel?: string } };
    if (!tokenResponse.ok || !result.ok || !result.access_token || !result.team?.id || !result.team.name || !result.incoming_webhook?.url || !result.incoming_webhook.channel_id || !result.incoming_webhook.channel) { response.status(502).json({ error: "Slack did not provide the required installation details." }); return; }
    await prisma.slackIntegration.upsert({
      where: { userId },
      create: { userId, teamId: result.team.id, teamName: result.team.name, channelId: result.incoming_webhook.channel_id, channelName: result.incoming_webhook.channel, webhookUrlEncrypted: encryptCredential(result.incoming_webhook.url), accessTokenEncrypted: encryptCredential(result.access_token), disconnectedAt: null },
      update: { teamId: result.team.id, teamName: result.team.name, channelId: result.incoming_webhook.channel_id, channelName: result.incoming_webhook.channel, webhookUrlEncrypted: encryptCredential(result.incoming_webhook.url), accessTokenEncrypted: encryptCredential(result.access_token), connectedAt: new Date(), disconnectedAt: null },
    });
    response.json({ connected: true, teamName: result.team.name, channelName: result.incoming_webhook.channel });
  } catch {
    response.status(502).json({ error: "Slack OAuth could not be completed." });
  }
});

slackRouter.get("/integrations/slack", requireAuth, async (_request, response) => {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId: response.locals.userId as string }, select: { teamName: true, channelName: true, connectedAt: true, disconnectedAt: true } });
  response.json({ connected: Boolean(integration && !integration.disconnectedAt), integration: integration && !integration.disconnectedAt ? integration : null });
});

slackRouter.delete("/integrations/slack", requireAuth, async (_request, response) => {
  const result = await prisma.slackIntegration.updateMany({ where: { userId: response.locals.userId as string, disconnectedAt: null }, data: { disconnectedAt: new Date() } });
  response.json({ disconnected: result.count > 0 });
});

export function closeSlackRedis(): void {
  redis.disconnect();
}
