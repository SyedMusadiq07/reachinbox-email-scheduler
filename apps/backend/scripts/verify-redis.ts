import { verifyRedisConnection } from "../src/queue/connection.js";

async function main(): Promise<void> {
  try {
    await verifyRedisConnection();
    console.log("Redis PING succeeded.");
  } catch {
    console.error("Redis connectivity check failed.");
    process.exitCode = 1;
  }
}

void main();
