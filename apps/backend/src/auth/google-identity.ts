import type { TokenPayload } from "google-auth-library";

export interface GoogleIdentity {
  googleId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export function validateGoogleIdentity(payload: TokenPayload, clientId: string, nowSeconds = Math.floor(Date.now() / 1000)): GoogleIdentity {
  const issuers = new Set(["accounts.google.com", "https://accounts.google.com"]);
  const audience = payload.aud;
  if (!payload.sub || !payload.email || payload.email_verified !== true || !payload.iss || !issuers.has(payload.iss)) {
    throw new Error("Google identity token is missing verified identity claims.");
  }
  if (audience !== clientId) {
    throw new Error("Google identity token audience does not match this application.");
  }
  if (!payload.exp || payload.exp <= nowSeconds) {
    throw new Error("Google identity token is expired.");
  }
  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    ...(typeof payload.name === "string" && payload.name ? { name: payload.name } : {}),
    ...(typeof payload.picture === "string" && payload.picture ? { avatarUrl: payload.picture } : {}),
  };
}
