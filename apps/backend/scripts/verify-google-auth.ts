import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { CodeChallengeMethod, OAuth2Client, type TokenPayload } from "google-auth-library";
import { prisma } from "../src/db/prisma.js";
import { createGoogleStateValue, consumeGoogleOAuthState, saveGoogleOAuthState } from "../src/auth/google-state.js";
import { validateGoogleIdentity } from "../src/auth/google-identity.js";
import { requireAuth } from "../src/auth/require-auth.js";
import { closeSessionRedis, sessionMiddleware, sessionRedisReady } from "../src/auth/session.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { slackRouter } from "../src/routes/slack.routes.js";
import { emailRouter } from "../src/routes/email.routes.js";
import { createProducerConnection } from "../src/queue/connection.js";
import { closeEmailQueue } from "../src/queue/email.queue.js";
import { emailQueue } from "../src/queue/email.queue.js";
import { closeEmailIndexQueue } from "../src/search/email-index.queue.js";
import { emailIndexQueue } from "../src/search/email-index.queue.js";
import { closeElasticsearchClient } from "../src/search/elasticsearch.js";
import { closeAuthRedis } from "../src/routes/auth.routes.js";
import { closeSlackRedis } from "../src/routes/slack.routes.js";

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const base64UrlJson = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const testSessionKeys = new Set<string>();

function signTestIdToken(privateKey: string, payload: TokenPayload): string {
  const unsigned = `${base64UrlJson({ alg: "RS256", kid: "phase7-verification-key", typ: "JWT" })}.${base64UrlJson(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}
const getCookie = (response: Response): string => {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Expected the server to set its httpOnly session cookie.");
  const value = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const sessionId = value.startsWith("s:") ? value.slice(2).split(".")[0] : undefined;
  if (sessionId) testSessionKeys.add(`reachinbox:session:${sessionId}`);
  return cookie;
};

function makeTestApp(authRouter: express.Router): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api", sessionMiddleware);
  app.use("/api", authRouter);
  app.use("/api", slackRouter);
  app.use("/api", requireAuth, emailRouter);
  return app;
}

async function listen(app: express.Express): Promise<{ server: ReturnType<typeof app.listen>; baseUrl: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Temporary auth test server did not bind a TCP port.");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function main(): Promise<void> {
  await sessionRedisReady;
  const redis = createProducerConnection();
  const suffix = randomUUID();
  const googleId = `auth-verify-${suffix}`;
  const secondGoogleId = `auth-verify-other-${suffix}`;
  const stateKeys: string[] = [];
  let userId: string | undefined;
  let otherUserId: string | undefined;
  let senderId: string | undefined;
  let otherSenderId: string | undefined;
  let otherCampaignId: string | undefined;
  let scheduledCampaignId: string | undefined;
  const scheduledJobIds: string[] = [];
  let liveServer: Awaited<ReturnType<typeof listen>> | undefined;
  let oauthCalls = 0;
  let callbackRetries = 0;
  let identityName = "Verified Test User";
  let currentChallenge: { codeVerifier: string; codeChallenge: string } | undefined;

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    assert(clientId && redirectUri, "Local Google OAuth client ID and redirect URI are configured.");
    process.env.SLACK_CLIENT_ID = "auth-verification-client";
    process.env.SLACK_STATE_SECRET = "phase-7-test-only-state-signing-secret-long-enough";
    const googleClient = new OAuth2Client(clientId, "test-only-not-used", redirectUri);
    const mockOAuth = {
      generateCodeVerifier: async () => {
        currentChallenge = await googleClient.generateCodeVerifierAsync();
        return currentChallenge;
      },
      authorizationUrl: ({ state, codeChallenge }: { state: string; codeChallenge: string }) => googleClient.generateAuthUrl({
        redirect_uri: redirectUri,
        response_type: "code",
        scope: ["openid", "email", "profile"],
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      }),
      exchange: async (_code: string, verifier: string) => {
        oauthCalls += 1;
        assert.equal(verifier, currentChallenge?.codeVerifier, "The matching PKCE verifier reaches token exchange.");
        return { googleId, email: `verified-${suffix}@example.test`, name: identityName, avatarUrl: "https://example.test/avatar.png" };
      },
    };
    const authRouter = createAuthRouter({ redis, oauth: mockOAuth });
    liveServer = await listen(makeTestApp(authRouter));
    const completeMockCallback = async (cookie: string, initialState?: string): Promise<{ response: Response; state: string }> => {
      let state = initialState;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!state || attempt > 0) {
          const retryStart = await fetch(`${liveServer!.baseUrl}/api/auth/google`, { headers: { cookie }, redirect: "manual" });
          if (retryStart.status !== 302) throw new Error(`Mock Google authorization retry returned ${retryStart.status}.`);
          const retryUrl = new URL(retryStart.headers.get("location") ?? "");
          state = retryUrl.searchParams.get("state") ?? undefined;
          if (!state) throw new Error("Mock Google authorization retry omitted state.");
        }
        const response = await fetch(`${liveServer!.baseUrl}/api/auth/google/callback?code=mock-code&state=${encodeURIComponent(state)}`, {
          headers: { cookie }, redirect: "manual",
        });
        if (response.status === 302) return { response, state };
        const safeError = await response.text();
        if (response.status !== 502 || attempt === 2) throw new Error(`Mock Google callback returned ${response.status}: ${safeError}`);
        callbackRetries += 1;
      }
      throw new Error("Mock Google callback retry limit reached.");
    };

    const unauthenticatedMe = await fetch(`${liveServer.baseUrl}/api/me`);
    assert.equal(unauthenticatedMe.status, 401);
    const unauthenticatedSenders = await fetch(`${liveServer.baseUrl}/api/senders`);
    assert.equal(unauthenticatedSenders.status, 401);
    const unauthenticatedSearch = await fetch(`${liveServer.baseUrl}/api/emails/search?q=example`);
    assert.equal(unauthenticatedSearch.status, 401);

    const validPayload = {
      iss: "https://accounts.google.com", aud: clientId, exp: Math.floor(Date.now() / 1000) + 300,
      sub: googleId, email: `verified-${suffix}@example.test`, email_verified: true, name: "Verified Test User",
    } satisfies TokenPayload;
    assert.equal(validateGoogleIdentity(validPayload, clientId).googleId, googleId);
    assert.throws(() => validateGoogleIdentity({ ...validPayload, aud: "wrong-client" }, clientId), /audience/);
    assert.throws(() => validateGoogleIdentity({ ...validPayload, exp: 1 }, clientId), /expired/);
    assert.throws(() => validateGoogleIdentity({ ...validPayload, iss: "https://attacker.test" }, clientId), /verified identity/);
    assert.throws(() => validateGoogleIdentity({ ...validPayload, email_verified: false }, clientId), /verified identity/);

    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const signatureVerifier = new OAuth2Client(clientId);
    signatureVerifier.getFederatedSignonCertsAsync = async () => ({
      certs: { "phase7-verification-key": publicKey }, format: "PEM",
    } as Awaited<ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>>);
    const signedPayload: TokenPayload = {
      ...validPayload, iat: Math.floor(Date.now() / 1000),
    };
    const signedIdToken = signTestIdToken(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), signedPayload);
    const signedTicket = await signatureVerifier.verifyIdToken({ idToken: signedIdToken, audience: clientId });
    assert.equal(signedTicket.getPayload()?.sub, googleId, "Official verifier accepts the correctly signed test token.");
    const wrongAudienceToken = signTestIdToken(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { ...signedPayload, aud: "wrong-client" });
    await assert.rejects(signatureVerifier.verifyIdToken({ idToken: wrongAudienceToken, audience: clientId }));
    const expiredToken = signTestIdToken(keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), { ...signedPayload, exp: 1 });
    await assert.rejects(signatureVerifier.verifyIdToken({ idToken: expiredToken, audience: clientId }));
    const tamperedToken = `${signedIdToken.slice(0, signedIdToken.lastIndexOf(".") + 1)}${Buffer.alloc(256, 0).toString("base64url")}`;
    await assert.rejects(signatureVerifier.verifyIdToken({ idToken: tamperedToken, audience: clientId }));

    const randomState = createGoogleStateValue();
    assert.match(randomState, /^[A-Za-z0-9_-]{43}$/);
    const verifier = await googleClient.generateCodeVerifierAsync();
    assert.equal(createHash("sha256").update(verifier.codeVerifier).digest("base64url"), verifier.codeChallenge);
    const expiredState = createGoogleStateValue();
    stateKeys.push(expiredState);
    await saveGoogleOAuthState(redis, expiredState, { flow: "google-login", issuedAt: Date.now(), sessionId: "expired-test", codeVerifier: verifier.codeVerifier }, 1);
    await pause(1_100);
    assert.equal(await consumeGoogleOAuthState(redis, expiredState), null, "Expired state is rejected.");

    const start = await fetch(`${liveServer.baseUrl}/api/auth/google`, { redirect: "manual" });
    assert.equal(start.status, 302);
    const authorizeUrl = new URL(start.headers.get("location") ?? "");
    assert.equal(authorizeUrl.origin, "https://accounts.google.com");
    assert.equal(authorizeUrl.searchParams.get("scope"), "openid email profile");
    assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
    const challenge = authorizeUrl.searchParams.get("code_challenge");
    assert(challenge && /^[A-Za-z0-9_-]+$/.test(challenge));
    const startCookie = getCookie(start);
    const state = authorizeUrl.searchParams.get("state");
    assert(state);

    const completedLogin = await completeMockCallback(startCookie, state);
    const callback = completedLogin.response;
    const consumedState = completedLogin.state;
    assert.equal(new URL(callback.headers.get("location") ?? "").pathname, "/dashboard");
    let authCookie = getCookie(callback);
    const me = await fetch(`${liveServer.baseUrl}/api/me`, { headers: { cookie: authCookie } });
    assert.equal(me.status, 200);
    const meData = await me.json() as { id: string; name: string; email: string; avatarUrl: string | null };
    assert.equal(meData.email, `verified-${suffix}@example.test`);
    assert.equal(meData.name, identityName);
    assert.equal(meData.avatarUrl, "https://example.test/avatar.png");
    userId = meData.id;
    assert.equal(oauthCalls, 1);

    const replay = await fetch(`${liveServer.baseUrl}/api/auth/google/callback?code=mock-code&state=${encodeURIComponent(consumedState)}`, {
      headers: { cookie: startCookie }, redirect: "manual",
    });
    assert.equal(replay.status, 400, "Consumed state cannot be replayed.");
    const invalidState = await fetch(`${liveServer.baseUrl}/api/auth/google/callback?code=mock-code&state=unrecognized`, {
      headers: { cookie: startCookie }, redirect: "manual",
    });
    assert.equal(invalidState.status, 400, "Unknown state is rejected.");

    const ownerSender = await prisma.sender.create({ data: {
      userId, email: `sender-${suffix}@example.test`, smtpHost: "localhost", smtpPort: 2525,
      smtpUsernameEncrypted: "test-ciphertext", smtpPasswordEncrypted: "test-ciphertext",
    } });
    senderId = ownerSender.id;
    const otherUser = await prisma.user.create({ data: {
      googleId: secondGoogleId, email: `other-${suffix}@example.test`, name: "Other User",
    } });
    otherUserId = otherUser.id;
    const foreignSender = await prisma.sender.create({ data: {
      userId: otherUser.id, email: `foreign-${suffix}@example.test`, smtpHost: "localhost", smtpPort: 2525,
      smtpUsernameEncrypted: "test-ciphertext", smtpPasswordEncrypted: "test-ciphertext",
    } });
    otherSenderId = foreignSender.id;
    const foreignCampaign = await prisma.campaign.create({ data: {
      userId: otherUser.id, senderId: foreignSender.id, subject: "Private", body: "private",
      startTime: new Date(), delayMs: 0, hourlyLimit: 1,
    } });
    otherCampaignId = foreignCampaign.id;
    const foreignJob = await prisma.emailJob.create({ data: {
      campaignId: foreignCampaign.id, senderId: foreignSender.id, recipientEmail: `private-${suffix}@example.test`,
      subject: "Private", body: "private", sequenceNumber: 0, scheduledAt: new Date(),
    } });
    const foreignRead = await fetch(`${liveServer.baseUrl}/api/emails/${foreignJob.id}`, { headers: { cookie: authCookie } });
    assert.equal(foreignRead.status, 404, "A logged-in user cannot read another user's EmailJob.");
    const senderListResponse = await fetch(`${liveServer.baseUrl}/api/senders`, { headers: { cookie: authCookie } });
    const senderList = await senderListResponse.json() as { items: Array<{ id: string }> };
    assert.deepEqual(senderList.items.map((item) => item.id), [ownerSender.id]);
    const foreignSchedule = await fetch(`${liveServer.baseUrl}/api/schedules`, {
      method: "POST", headers: { cookie: authCookie, "content-type": "application/json", "Idempotency-Key": `auth-${suffix}` },
      body: JSON.stringify({ userId: otherUser.id, senderId: foreignSender.id, recipients: [`victim-${suffix}@example.test`], subject: "No", body: "No", startTime: new Date(Date.now() + 60_000).toISOString(), delayMs: 0, hourlyLimit: 1 }),
    });
    assert.equal(foreignSchedule.status, 404, "A client-supplied user ID cannot claim a foreign sender.");
    const validSchedule = await fetch(`${liveServer.baseUrl}/api/schedules`, {
      method: "POST", headers: { cookie: authCookie, "content-type": "application/json", "Idempotency-Key": `auth-owned-${suffix}` },
      body: JSON.stringify({ userId: otherUser.id, senderId: ownerSender.id, recipients: [`owned-${suffix}@example.test`], subject: "Authenticated schedule", body: "test only", startTime: new Date(Date.now() + 3_600_000).toISOString(), delayMs: 0, hourlyLimit: 1 }),
    });
    assert.equal(validSchedule.status, 201, "An authenticated user can still schedule with their own active sender.");
    const scheduled = await validSchedule.json() as { campaignId: string; emailJobIds: string[] };
    scheduledCampaignId = scheduled.campaignId;
    scheduledJobIds.push(...scheduled.emailJobIds);
    const ownedCampaign = await prisma.campaign.findUnique({ where: { id: scheduledCampaignId }, select: { userId: true } });
    assert.equal(ownedCampaign?.userId, userId, "Campaign ownership comes from the authenticated session, not the request body.");
    const listed = await fetch(`${liveServer.baseUrl}/api/emails?status=scheduled`, { headers: { cookie: authCookie } });
    const listedBody = await listed.json() as { items: Array<{ id: string }> };
    assert.equal(listed.status, 200);
    assert(scheduledJobIds.some((id) => listedBody.items.some((item) => item.id === id)), "The signed-in user's scheduled list includes its new EmailJob.");

    const slackStart = await fetch(`${liveServer.baseUrl}/api/auth/slack`, { headers: { cookie: authCookie }, redirect: "manual" });
    assert.equal(slackStart.status, 302);
    const slackState = new URL(slackStart.headers.get("location") ?? "").searchParams.get("state");
    const slackNonce = slackState?.split(".")[0];
    assert(slackNonce);
    assert.equal(await redis.get(`slack:oauth-state:${slackNonce}`), userId, "Slack OAuth state binds the installation to the Google-authenticated user.");
    const slackStatus = await fetch(`${liveServer.baseUrl}/api/integrations/slack`, { headers: { cookie: authCookie } });
    assert.equal(slackStatus.status, 200);
    assert.equal((await slackStatus.json() as { connected: boolean }).connected, false);
    await redis.del(`slack:oauth-state:${slackNonce}`);

    identityName = "Updated Verified Test User";
    const secondLogin = await completeMockCallback(authCookie);
    const secondCallback = secondLogin.response;
    authCookie = getCookie(secondCallback);
    const reusedUser = await prisma.user.findUnique({ where: { googleId }, select: { id: true, name: true } });
    assert.equal(reusedUser?.id, userId, "Repeat login preserves the existing database user ID.");
    assert.equal(reusedUser?.name, identityName, "Verified profile name refreshes on repeat login.");
    assert.equal(await prisma.user.count({ where: { googleId } }), 1, "Repeat login does not create duplicate User rows.");

    await closeServer(liveServer.server);
    liveServer = await listen(makeTestApp(authRouter));
    const afterRestart = await fetch(`${liveServer.baseUrl}/api/me`, { headers: { cookie: authCookie } });
    assert.equal(afterRestart.status, 200, "The Redis-backed session survives an API server listener restart.");
    const logout = await fetch(`${liveServer.baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: authCookie } });
    assert.equal(logout.status, 200);
    assert.equal((await logout.json() as { loggedOut: boolean }).loggedOut, true);
    assert.equal((await fetch(`${liveServer.baseUrl}/api/me`, { headers: { cookie: authCookie } })).status, 401);
    assert.equal((await fetch(`${liveServer.baseUrl}/api/auth/logout`, { method: "POST" })).status, 200, "Logout is safe when already logged out.");

    console.info(`Google auth verification passed: unauthenticated API rejection, random single-use Redis state and expiry, S256 PKCE, signed-token validation, mocked OAuth callback with real DB persistence, duplicate-login reuse, Redis session persistence across API listener restart, logout, authenticated scheduling/listing, sender/email isolation, and Slack state user binding (callback retries used: ${callbackRetries}).`);
    console.info("Live Google authorization redirect was generated, but the external browser sign-in/callback was not completed by this automated test.");
  } finally {
    if (liveServer) await closeServer(liveServer.server).catch(() => undefined);
    for (const id of scheduledJobIds) await emailQueue.getJob(id).then((job) => job?.remove()).catch(() => undefined);
    if (scheduledJobIds.length) {
      const pendingIndexJobs = await emailIndexQueue.getJobs(["waiting", "delayed", "paused", "failed"], 0, -1, true).catch(() => []);
      for (const job of pendingIndexJobs) if (scheduledJobIds.includes(job.data.emailJobId)) await job.remove().catch(() => undefined);
    }
    if (testSessionKeys.size) await redis.del(...testSessionKeys).catch(() => undefined);
    await redis.del(...stateKeys.map((key) => `google:oauth-state:${key}`)).catch(() => undefined);
    if (scheduledCampaignId) await prisma.campaign.delete({ where: { id: scheduledCampaignId } }).catch(() => undefined);
    if (otherCampaignId) await prisma.campaign.delete({ where: { id: otherCampaignId } }).catch(() => undefined);
    if (senderId) await prisma.sender.delete({ where: { id: senderId } }).catch(() => undefined);
    if (otherSenderId) await prisma.sender.delete({ where: { id: otherSenderId } }).catch(() => undefined);
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    if (otherUserId) await prisma.user.delete({ where: { id: otherUserId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { googleId: { in: [googleId, secondGoogleId] } } }).catch(() => undefined);
    redis.disconnect();
    await closeAuthRedis();
    closeSlackRedis();
    await closeSessionRedis();
    await closeEmailQueue();
    await closeEmailIndexQueue();
    await closeElasticsearchClient();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`Google auth verification failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}).then(() => process.exit(process.exitCode ?? 0));
