import { randomBytes } from "node:crypto";
import type Redis from "ioredis";

const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

export class EmailDeliveryLockBusyError extends Error {
  constructor(emailJobId: string) {
    super(`Email delivery for ${emailJobId} is already in progress.`);
    this.name = "EmailDeliveryLockBusyError";
  }
}

export function getEmailDeliveryLockTtlMs(): number {
  const ttlMs = Number(process.env.EMAIL_DELIVERY_LOCK_TTL_MS ?? 900_000);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("EMAIL_DELIVERY_LOCK_TTL_MS must be a positive safe integer.");
  }
  return ttlMs;
}

export async function withEmailDeliveryLock<T>(
  redis: Redis,
  emailJobId: string,
  ttlMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `email:delivery-lock:${emailJobId}`;
  const token = randomBytes(32).toString("hex");
  const acquired = await redis.set(key, token, "PX", ttlMs, "NX");

  if (acquired !== "OK") throw new EmailDeliveryLockBusyError(emailJobId);

  try {
    return await operation();
  } finally {
    await redis.eval(RELEASE_IF_OWNER_SCRIPT, 1, key, token);
  }
}
