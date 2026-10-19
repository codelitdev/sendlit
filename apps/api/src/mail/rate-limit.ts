import { defaultMaxSendRates } from "@sendlit/api-contract";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { db } from "../db/client";
import { espConfigs } from "../db/schema";
import { captureError } from "../observability";
import redisConfig from "../services/redis";
import type { EspProvider } from "../settings/esp/queries";

/** The longest a send waits in-process for its slot. Beyond this the send is
 * deferred and retried later instead of tying up a worker. */
const MAX_WAIT_MS = 30_000;

/** A send that couldn't go out now, because of the ESP's rate limit (ours or
 * the provider's). Callers reschedule it instead of counting a failure. */
export class SendDeferredError extends Error {
  constructor(
    readonly retryAfterMs: number,
    message = "send_rate_limited",
  ) {
    super(message);
    this.name = "SendDeferredError";
  }
}

export function effectiveMaxSendRate(esp: {
  provider: string;
  maxSendRate: number | null;
}): number | null {
  return esp.maxSendRate ?? defaultMaxSendRates[esp.provider as EspProvider] ?? null;
}

// Generic cell rate algorithm over a "theoretical arrival time" per ESP. Each
// call reserves the next slot `interval` ms after the previous one, so sends
// through one ESP are spaced evenly across every worker and process. Returns
// how long to wait for the reserved slot, or a negative number (nothing
// reserved) when that would exceed `maxWait`.
const RESERVE_SLOT = `
local interval = tonumber(ARGV[1])
local maxWait = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
local wait = tat - now
if wait > maxWait then return -wait end
redis.call('SET', KEYS[1], tat + interval, 'PX', wait + interval + 1000)
return wait
`;

let client: Redis | null = null;

function redis(): Redis {
  client ??= new Redis({ ...redisConfig, maxRetriesPerRequest: 2 });
  return client;
}

export async function closeSendRateLimiter(): Promise<void> {
  await client?.quit().catch(() => undefined);
  client = null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until one more message may go through `espConfigId` at
 * `ratePerSecond`. Throws `SendDeferredError` when the queue for that ESP is
 * longer than `MAX_WAIT_MS`. If Redis is unreachable the send goes ahead
 * unthrottled rather than failing.
 */
export async function waitForSendSlot(
  espConfigId: string,
  ratePerSecond: number,
  { maxWaitMs = MAX_WAIT_MS }: { maxWaitMs?: number } = {},
): Promise<void> {
  const interval = Math.ceil(1000 / ratePerSecond);
  let wait: number;
  try {
    wait = Number(
      await redis().eval(
        RESERVE_SLOT,
        1,
        `sendlit:send-rate:${espConfigId}`,
        interval,
        maxWaitMs,
      ),
    );
  } catch (error) {
    captureError({ error, source: "mail.send_rate_limit", severity: "warning" });
    return;
  }
  if (wait < 0) throw new SendDeferredError(-wait);
  if (wait > 0) await sleep(wait);
}

/** Holds a send through `espConfigId` (internal id) until its rate limit
 * allows it. */
export async function throttleForEsp(espConfigId: string): Promise<void> {
  const [esp] = await db
    .select({ provider: espConfigs.provider, maxSendRate: espConfigs.maxSendRate })
    .from(espConfigs)
    .where(eq(espConfigs.id, espConfigId))
    .limit(1);
  const rate = esp ? effectiveMaxSendRate(esp) : null;
  if (rate) await waitForSendSlot(espConfigId, rate);
}

/** SMTP replies that mean "slow down" or "come back later" rather than a
 * rejection: 421/450/451/452/454, and provider throttling messages such as
 * SES's `454 Throttling failure: Maximum sending rate exceeded`. */
export function throttlingRetryDelay(error: unknown): number | null {
  const err = error as { responseCode?: unknown; message?: unknown };
  const message = typeof err?.message === "string" ? err.message : "";
  const code = typeof err?.responseCode === "number" ? err.responseCode : null;
  const throttled =
    /throttl|rate exceeded|sending rate|too many (messages|requests|connections)|quota exceeded/i.test(
      message,
    );
  if (!throttled && !(code !== null && [421, 450, 451, 452, 454].includes(code))) {
    return null;
  }
  // A daily quota resets slowly; per-second throttling clears quickly.
  return /daily|quota/i.test(message) ? 15 * 60_000 : 60_000;
}
