import type Redis from "ioredis";

export type RateDecision = { kind: "allow"; reservedAt: number; hourStart: number } | { kind: "wait"; retryAt: number; hourStart: number } | { kind: "hourly-limit"; retryAt: number; hourStart: number };

// Redis server time and all state changes are in the same script. UTC epoch-hour buckets expire after two hours.
const RESERVE_SCRIPT = `
local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local hour=math.floor(now/3600000)*3600000
local rate='email:rate:'..ARGV[1]..':'..hour
local nextKey='email:next-send:'..ARGV[1]
local count=tonumber(redis.call('GET',rate) or '0')
if count >= tonumber(ARGV[2]) then return {'hourly-limit',hour+3600000,hour} end
local nextAt=tonumber(redis.call('GET',nextKey) or '0')
if nextAt > now then return {'wait',nextAt,hour} end
redis.call('INCR',rate); if count==0 then redis.call('EXPIRE',rate,7200) end
local gap=tonumber(ARGV[3]); local slot=now+gap
redis.call('SET',nextKey,slot,'PX',math.max(86400000,gap+3600000))
return {'allow',now,hour}
`;

export function getRateLimitConfig(): { minDelayMs: number; hourlyLimit: number } {
  const minDelayMs = Number(process.env.MIN_EMAIL_DELAY_MS ?? 2000);
  const hourlyLimit = Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 200);
  if (!Number.isSafeInteger(minDelayMs) || minDelayMs < 0) throw new Error("MIN_EMAIL_DELAY_MS must be a nonnegative integer.");
  if (!Number.isSafeInteger(hourlyLimit) || hourlyLimit < 1) throw new Error("MAX_EMAILS_PER_HOUR_PER_SENDER must be a positive integer.");
  return { minDelayMs, hourlyLimit };
}

export async function reserveSenderSend(redis: Redis, senderId: string, config = getRateLimitConfig()): Promise<RateDecision> {
  const result = await redis.eval(RESERVE_SCRIPT, 0, senderId, config.hourlyLimit, config.minDelayMs) as [string, number | string, number | string];
  const kind = result[0], value = Number(result[1]), hourStart = Number(result[2]);
  if (kind === "allow") return { kind, reservedAt: value, hourStart };
  if (kind === "wait") return { kind, retryAt: value, hourStart };
  return { kind: "hourly-limit", retryAt: value, hourStart };
}

export async function claimRateAlert(redis: Redis, senderId: string, hourStart: number): Promise<boolean> {
  return (await redis.set(`email:rate-alert:${senderId}:${hourStart}`, "1", "EX", 7200, "NX")) === "OK";
}
