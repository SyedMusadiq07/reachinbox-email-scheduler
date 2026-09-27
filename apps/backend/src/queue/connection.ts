import "dotenv/config";
import IORedis from "ioredis";

export function getRedisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

export function getWorkerConcurrency(): number {
  const configured = Number(process.env.WORKER_CONCURRENCY ?? 10);
  if (!Number.isInteger(configured) || configured < 1) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer.");
  }
  return configured;
}

export function createProducerConnection(): IORedis {
  return new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
}

export function createWorkerConnection(): IORedis {
  return new IORedis(getRedisUrl(), { maxRetriesPerRequest: null });
}

export async function verifyRedisConnection(): Promise<void> {
  const connection = new IORedis(getRedisUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
  });
  connection.on("error", () => undefined);

  try {
    await connection.connect();
    const response = await connection.ping();
    if (response !== "PONG") {
      throw new Error("Unexpected Redis PING response.");
    }
  } finally {
    connection.disconnect();
  }
}
