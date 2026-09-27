import { randomBytes } from "node:crypto";
import type Redis from "ioredis";

export const GOOGLE_STATE_TTL_SECONDS = 600;
export interface GoogleOAuthState {
  flow: "google-login";
  issuedAt: number;
  sessionId: string;
  codeVerifier: string;
}

export function createGoogleStateValue(): string {
  return randomBytes(32).toString("base64url");
}

export async function saveGoogleOAuthState(redis: Redis, state: string, value: GoogleOAuthState, ttlSeconds = GOOGLE_STATE_TTL_SECONDS): Promise<void> {
  const stored = await redis.set(`google:oauth-state:${state}`, JSON.stringify(value), "EX", ttlSeconds, "NX");
  if (stored !== "OK") throw new Error("Could not create a unique Google OAuth state.");
}

export async function consumeGoogleOAuthState(redis: Redis, state: string): Promise<GoogleOAuthState | null> {
  const value = await redis.getdel(`google:oauth-state:${state}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GoogleOAuthState>;
    if (parsed.flow !== "google-login" || !Number.isSafeInteger(parsed.issuedAt) || typeof parsed.sessionId !== "string" || typeof parsed.codeVerifier !== "string") return null;
    if (Date.now() - (parsed.issuedAt as number) > GOOGLE_STATE_TTL_SECONDS * 1000 || parsed.issuedAt! > Date.now() + 30_000) return null;
    return parsed as GoogleOAuthState;
  } catch {
    return null;
  }
}
