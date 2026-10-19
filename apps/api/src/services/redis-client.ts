import Redis from "ioredis";
import redisConfig from "./redis";

let client: Redis | null = null;

/** One lazily-connected Redis client for SendLit's own keys (send limits,
 * signup counters). BullMQ keeps its own connections. */
export function sharedRedis(): Redis {
  client ??= new Redis({ ...redisConfig, maxRetriesPerRequest: 2 });
  return client;
}

export async function closeSharedRedis(): Promise<void> {
  await client?.quit().catch(() => undefined);
  client = null;
}
