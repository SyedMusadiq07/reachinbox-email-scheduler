import "dotenv/config";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import cors from "cors";
import express from "express";
import { verifyRedisConnection } from "./queue/connection.js";
import { emailQueue } from "./queue/email.queue.js";
import { emailIndexQueue } from "./search/email-index.queue.js";
import { requireAuth } from "./auth/require-auth.js";
import { sessionMiddleware } from "./auth/session.js";
import { authRouter } from "./routes/auth.routes.js";
import { emailRouter } from "./routes/email.routes.js";
import { slackRouter } from "./routes/slack.routes.js";

const app = express();
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue), new BullMQAdapter(emailIndexQueue)],
  serverAdapter,
});

const configuredFrontend = new URL(process.env.FRONTEND_URL ?? "http://localhost:3000");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(cors({ origin: configuredFrontend.origin, credentials: true }));
app.use(express.json());
app.use("/api", sessionMiddleware);
app.use("/api", authRouter);
app.use("/api", slackRouter);
app.use("/api", requireAuth, emailRouter);
app.use("/admin/queues", serverAdapter.getRouter());
app.get("/health", (_request, response) => response.json({ status: "ok" }));
app.get("/health/redis", async (_request, response) => {
  try {
    await verifyRedisConnection();
    response.json({ status: "ok", redis: "ready" });
  } catch {
    response.status(503).json({ status: "error", redis: "unavailable" });
  }
});

export { app };
