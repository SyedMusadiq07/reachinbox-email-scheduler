import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";

export async function requireAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const userId = request.session.userId;
  if (!userId) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    if (!user) {
      request.session.destroy(() => undefined);
      response.status(401).json({ error: "Authentication required." });
      return;
    }
    request.authenticatedUser = user;
    response.locals.userId = user.id;
    next();
  } catch {
    response.status(503).json({ error: "Authentication could not be verified." });
  }
}
