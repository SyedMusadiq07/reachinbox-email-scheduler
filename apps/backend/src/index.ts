import { app } from "./app.js";
import { closeEmailQueue } from "./queue/email.queue.js";
import { closeEmailIndexQueue } from "./search/email-index.queue.js";
import { closeElasticsearchClient } from "./search/elasticsearch.js";
import { closeAuthRedis } from "./routes/auth.routes.js";
import { closeSessionRedis } from "./auth/session.js";
import { closeSlackRedis } from "./routes/slack.routes.js";

const port = Number(process.env.BACKEND_PORT ?? 4000);

const server = app.listen(port, () => {
  console.log(`Backend scaffold listening on port ${port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing API and queue connections.`);
  server.close(async () => {
    await closeAuthRedis();
    closeSlackRedis();
    await closeSessionRedis();
    await closeEmailQueue();
    await closeEmailIndexQueue();
    await closeElasticsearchClient();
    process.exitCode = 0;
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

