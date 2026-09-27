import type { User } from "../generated/prisma/client.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    googleOAuthStartedAt?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: Pick<User, "id" | "name" | "email" | "avatarUrl">;
    }
  }
}

export {};
