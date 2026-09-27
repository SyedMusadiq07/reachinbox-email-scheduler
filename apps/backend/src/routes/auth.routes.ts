import "dotenv/config";
import { Router } from "express";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type Redis from "ioredis";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { createProducerConnection } from "../queue/connection.js";
import { consumeGoogleOAuthState, createGoogleStateValue, saveGoogleOAuthState } from "../auth/google-state.js";
import { validateGoogleIdentity, type GoogleIdentity } from "../auth/google-identity.js";
import { requireAuth } from "../auth/require-auth.js";
import { sessionCookieName, sessionCookieOptions } from "../auth/session.js";

interface GoogleOAuthExchange {
  exchange(code: string, codeVerifier: string): Promise<GoogleIdentity>;
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  generateCodeVerifier(): Promise<{ codeVerifier: string; codeChallenge: string }>;
}

interface AuthDependencies {
  redis: Redis;
  oauth: GoogleOAuthExchange;
  findUser(googleId: string): Promise<{ id: string; name: string; email: string; avatarUrl: string | null } | null>;
  findUserByEmail(email: string): Promise<{ id: string; googleId: string } | null>;
  createUser(input: GoogleIdentity): Promise<{ id: string; name: string; email: string; avatarUrl: string | null }>;
  updateUser(id: string, input: GoogleIdentity): Promise<{ id: string; name: string; email: string; avatarUrl: string | null }>;
}

function getGoogleConfig(): { clientId: string; clientSecret: string; redirectUri: string; frontendUrl: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  if (!clientId || !clientSecret || !redirectUri) throw new Error("Google OAuth environment is incomplete.");
  const callback = new URL(redirectUri);
  if (callback.protocol !== "http:" && callback.protocol !== "https:") throw new Error("GOOGLE_REDIRECT_URI must be an HTTP(S) URL.");
  const frontend = new URL(frontendUrl);
  if (frontend.protocol !== "http:" && frontend.protocol !== "https:") throw new Error("FRONTEND_URL must be an HTTP(S) URL.");
  return { clientId, clientSecret, redirectUri: callback.toString(), frontendUrl: frontend.toString() };
}

function productionOAuth(): GoogleOAuthExchange {
  const getClient = () => {
    const config = getGoogleConfig();
    return { config, client: new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri) };
  };
  return {
    generateCodeVerifier: async () => {
      const generated = await getClient().client.generateCodeVerifierAsync();
      if (!generated.codeChallenge) throw new Error("Google did not generate an S256 PKCE challenge.");
      return { codeVerifier: generated.codeVerifier, codeChallenge: generated.codeChallenge };
    },
    authorizationUrl: ({ state, codeChallenge }) => {
      const { config, client } = getClient();
      return client.generateAuthUrl({
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: ["openid", "email", "profile"],
        state,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
      });
    },
    exchange: async (code, codeVerifier) => {
      const { config, client } = getClient();
      const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: config.redirectUri });
      if (!tokens.id_token) throw new Error("Google did not return an ID token.");
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
      const payload = ticket.getPayload();
      if (!payload) throw new Error("Google ID token has no identity payload.");
      return validateGoogleIdentity(payload, config.clientId);
    },
  };
}

const databaseDependencies = (): Pick<AuthDependencies, "findUser" | "findUserByEmail" | "createUser" | "updateUser"> => ({
  findUser: (googleId) => prisma.user.findUnique({ where: { googleId }, select: { id: true, name: true, email: true, avatarUrl: true } }),
  findUserByEmail: (email) => prisma.user.findUnique({ where: { email }, select: { id: true, googleId: true } }),
  createUser: (identity) => prisma.user.create({
    data: { googleId: identity.googleId, email: identity.email, name: identity.name ?? identity.email.split("@")[0] ?? identity.email, avatarUrl: identity.avatarUrl ?? null },
    select: { id: true, name: true, email: true, avatarUrl: true },
  }),
  updateUser: (id, identity) => prisma.user.update({
    where: { id },
    data: { email: identity.email, ...(identity.name ? { name: identity.name } : {}), ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}) },
    select: { id: true, name: true, email: true, avatarUrl: true },
  }),
});

const defaultRedis = createProducerConnection();

export function createAuthRouter(overrides: Partial<AuthDependencies> = {}): Router {
  const oauth = overrides.oauth ?? productionOAuth();
  const database = databaseDependencies();
  const dependencies: AuthDependencies = {
    redis: overrides.redis ?? defaultRedis,
    oauth,
    ...database,
    ...overrides,
  };
  const router = Router();

  router.get("/auth/dev-login", async (request, response) => {
    try {
      let user = await prisma.user.findFirst({ where: { email: "dev@example.com" } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            googleId: "dev-google-id-12345",
            email: "dev@example.com",
            name: "Developer User",
            avatarUrl: null,
          },
        });
      }
      await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
      request.session.userId = user.id;
      await new Promise<void>((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
      const frontend = new URL("/dashboard", frontendUrl);
      response.status(302).header("Location", frontend.toString()).end();
    } catch (error) {
      console.error("[Dev Login] Error:", error);
      response.status(500).json({ error: "Dev login failed." });
    }
  });

  router.get("/auth/google", async (request, response) => {
    try { getGoogleConfig(); }
    catch { response.status(503).json({ error: "Google OAuth is not configured." }); return; }
    try {
      const { codeVerifier, codeChallenge } = await dependencies.oauth.generateCodeVerifier();
      const state = createGoogleStateValue();
      await saveGoogleOAuthState(dependencies.redis, state, {
        flow: "google-login", issuedAt: Date.now(), sessionId: request.sessionID, codeVerifier,
      });
      request.session.googleOAuthStartedAt = Date.now();
      await new Promise<void>((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
      response.status(302).header("Location", dependencies.oauth.authorizationUrl({ state, codeChallenge })).end();
    } catch (error) {
      console.error("[Google OAuth start] Error:", error);
      response.status(503).json({ error: "Google sign-in could not be started." });
    }
  });

  router.get("/auth/google/callback", async (request, response) => {
    const query = z.object({ state: z.string().min(1), code: z.string().min(1).optional(), error: z.string().optional() }).safeParse(request.query);
    if (!query.success) { response.status(400).json({ error: "Invalid Google OAuth callback." }); return; }
    try {
      const state = await consumeGoogleOAuthState(dependencies.redis, query.data.state);
      if (!state) {
        response.status(400).json({ error: "Google OAuth state expired, invalid, or already used." });
        return;
      }
      if (query.data.error || !query.data.code) {
        response.status(400).json({ error: "Google sign-in was not completed." });
        return;
      }

      const identity = await dependencies.oauth.exchange(query.data.code, state.codeVerifier);
      let user = await dependencies.findUser(identity.googleId);
      if (!user) {
        const matchingEmail = await dependencies.findUserByEmail(identity.email);
        if (matchingEmail) {
          response.status(409).json({ error: "This email is already linked to a different Google identity." });
          return;
        }
        try { user = await dependencies.createUser(identity); }
        catch (error) {
          // Resolve a simultaneous callback for the same Google subject without duplicating the user.
          user = await dependencies.findUser(identity.googleId);
          if (!user) throw error;
        }
      } else {
        const matchingEmail = await dependencies.findUserByEmail(identity.email);
        if (matchingEmail && matchingEmail.id !== user.id) {
          response.status(409).json({ error: "This email is already linked to a different Google identity." });
          return;
        }
        user = await dependencies.updateUser(user.id, identity);
      }

      await new Promise<void>((resolve, reject) => request.session.regenerate((error) => error ? reject(error) : resolve()));
      request.session.userId = user.id;
      await new Promise<void>((resolve, reject) => request.session.save((error) => error ? reject(error) : resolve()));
      const frontend = new URL(configuredDashboardPath(), getGoogleConfig().frontendUrl);
      response.status(302).header("Location", frontend.toString()).end();
    } catch (error) {
      console.error("[Google OAuth callback] Error:", error);
      response.status(502).json({ error: "Google sign-in could not be completed." });
    }
  });

  router.get("/me", requireAuth, (request, response) => {
    const user = request.authenticatedUser;
    if (!user) { response.status(401).json({ error: "Authentication required." }); return; }
    response.json({ id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl });
  });



  router.post("/auth/logout", (request, response) => {
    const clearOptions = { path: sessionCookieOptions.path, httpOnly: true, secure: sessionCookieOptions.secure, sameSite: sessionCookieOptions.sameSite };
    if (!request.session) {
      response.clearCookie(sessionCookieName, clearOptions).json({ loggedOut: true });
      return;
    }
    request.session.destroy((error) => {
      response.clearCookie(sessionCookieName, clearOptions);
      if (error) { response.status(503).json({ error: "Session could not be cleared." }); return; }
      response.json({ loggedOut: true });
    });
  });

  return router;
}

function configuredDashboardPath(): string {
  return "/dashboard";
}

export const authRouter = createAuthRouter();

export async function closeAuthRedis(): Promise<void> {
  defaultRedis.disconnect();
}
