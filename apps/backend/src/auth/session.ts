import "dotenv/config";
import { RedisStore } from "connect-redis";
import session from "express-session";
import type { RequestHandler } from "express";
import { createClient } from "redis";
import { getRedisUrl } from "../queue/connection.js";

const configuredMaxAge = Number(process.env.SESSION_MAX_AGE_MS ?? 604_800_000);
if (!Number.isSafeInteger(configuredMaxAge) || configuredMaxAge < 60_000) {
  throw new Error("SESSION_MAX_AGE_MS must be an integer of at least 60000.");
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
const sameSiteValue = process.env.SESSION_COOKIE_SAME_SITE ?? "lax";
if (!["lax", "strict", "none"].includes(sameSiteValue)) {
  throw new Error("SESSION_COOKIE_SAME_SITE must be lax, strict, or none.");
}

export const sessionCookieName = "reachinbox.sid";
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" || sameSiteValue === "none",
  sameSite: sameSiteValue as "lax" | "strict" | "none",
  path: "/",
  maxAge: configuredMaxAge,
};

export const sessionRedisClient = createClient({ url: getRedisUrl() });
sessionRedisClient.on("error", () => {
  // Redis errors must not leak connection details or credentials into logs.
});
export const sessionRedisReady = sessionRedisClient.connect();
void sessionRedisReady.catch(() => undefined);

const store = new RedisStore({ client: sessionRedisClient, prefix: "reachinbox:session:" });
const configuredSessionMiddleware = session({
  name: sessionCookieName,
  store,
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: sessionCookieOptions,
});

export const sessionMiddleware: RequestHandler = (request, response, next) => {
  void sessionRedisReady.then(() => configuredSessionMiddleware(request, response, next)).catch(() => {
    response.status(503).json({ error: "Session storage is temporarily unavailable." });
  });
};

export async function closeSessionRedis(): Promise<void> {
  await sessionRedisReady.catch(() => undefined);
  if (sessionRedisClient.isOpen) await sessionRedisClient.quit();
}
