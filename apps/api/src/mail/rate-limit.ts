import { defaultMaxSendRates } from "@sendlit/api-contract";
import { eq } from "drizzle-orm";
import { untilNextUtcHour } from "../abuse/pacing";
import { db } from "../db/client";
import { espConfigs } from "../db/schema";
import { captureError } from "../observability";
import { closeSharedRedis, sharedRedis } from "../services/redis-client";
import type { EspProvider } from "../settings/esp/queries";
import { effectiveDailySendLimit } from "./warmup";

/** The longest a send waits in-process for its slot. Beyond this the send is
 * deferred and retried later instead of tying up a worker. */
const MAX_WAIT_MS = 30_000;

/** A send that couldn't go out now: the ESP's rate limit (ours or the
 * provider's) or its daily warm-up cap. Callers reschedule it instead of
 * counting a failure. */
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

const redis = sharedRedis;

export async function closeSendRateLimiter(): Promise<void> {
  await closeSharedRedis();
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

// Counts today's (UTC) marketing sends per ESP. Returns 0 without counting
// when the cap is already reached.
const COUNT_DAILY_SEND = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

function dailySendKey(espConfigId: string, now = new Date()) {
  return `sendlit:daily-sends:${espConfigId}:${now.toISOString().slice(0, 10)}`;
}

/** How long until the next UTC day, plus up to 10 minutes so a capped
 * broadcast doesn't wake up all at once at midnight. */
export function untilNextUtcDay(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime() + Math.floor(Math.random() * 600_000);
}

/**
 * Counts one marketing send against the ESP's daily warm-up cap, or throws
 * `SendDeferredError` until the next UTC day when the cap is reached.
 * Returns a function that gives the send back (when it then fails). Like the
 * rate limit, a Redis outage lets the send through.
 */
export async function reserveDailySend(
  espConfigId: string,
  limit: number,
): Promise<() => Promise<void>> {
  const key = dailySendKey(espConfigId);
  let granted: number;
  try {
    granted = Number(
      await redis().eval(COUNT_DAILY_SEND, 1, key, limit, 2 * 86_400_000),
    );
  } catch (error) {
    captureError({ error, source: "mail.daily_send_limit", severity: "warning" });
    return async () => undefined;
  }
  if (!granted)
    throw new SendDeferredError(untilNextUtcDay(), "daily_send_limit_reached");
  return async () => {
    await redis()
      .decr(key)
      .catch(() => undefined);
  };
}

/** Marketing sends through one ESP today (UTC), for showing warm-up
 * progress; `null` when Redis can't say. */
export async function dailySendCount(espConfigId: string): Promise<number | null> {
  try {
    return Number((await redis().get(dailySendKey(espConfigId))) ?? 0);
  } catch {
    return null;
  }
}

/**
 * Holds a send through `espConfigId` (internal id) until the ESP has
 * capacity: within its daily warm-up cap (marketing mail only, so
 * transactional mail like sign-in codes keeps flowing) and its per-second
 * rate. Returns a function to call if the send then fails, so it doesn't
 * count against today's cap.
 */
export async function acquireEspSendCapacity(
  espConfigId: string,
  purpose: "campaign" | "transactional",
): Promise<() => Promise<void>> {
  const [esp] = await db
    .select({
      provider: espConfigs.provider,
      maxSendRate: espConfigs.maxSendRate,
      dailySendLimit: espConfigs.dailySendLimit,
      warmupTargetDaily: espConfigs.warmupTargetDaily,
      warmupStartedAt: espConfigs.warmupStartedAt,
    })
    .from(espConfigs)
    .where(eq(espConfigs.id, espConfigId))
    .limit(1);
  if (!esp) return async () => undefined;
  const dailyLimit = effectiveDailySendLimit(esp);
  const release =
    purpose === "campaign" && dailyLimit !== null
      ? await reserveDailySend(espConfigId, dailyLimit)
      : async () => undefined;
  const rate = effectiveMaxSendRate(esp);
  try {
    if (rate) await waitForSendSlot(espConfigId, rate);
  } catch (error) {
    await release();
    throw error;
  }
  return release;
}

/** An organization ESP grant's daily/monthly quota (see `delivery/quota.ts`)
 * or the new-organization marketing ramp being used up, as a deferral until
 * it resets, so campaign mail waits instead of failing. */
export function quotaExhaustionDeferral(error: unknown): SendDeferredError | null {
  const err = error as {
    message?: unknown;
    retryAfter?: unknown;
    details?: { capability?: unknown };
  };
  // A new organization's daily marketing ramp (billing/entitlements.ts) is
  // per UTC day, so the rest of a broadcast continues tomorrow.
  if (
    err?.message === "plan_limit_reached" &&
    err.details?.capability === "marketing_daily_ramp"
  ) {
    return new SendDeferredError(untilNextUtcDay(), "marketing_daily_ramp");
  }
  // A new organization's sends are spread across the day (abuse/pacing.ts).
  if (
    err?.message === "plan_limit_reached" &&
    err.details?.capability === "marketing_hourly_pacing"
  ) {
    return new SendDeferredError(untilNextUtcHour(), "marketing_hourly_pacing");
  }
  if (
    err?.message !== "organization_team_quota_exhausted" &&
    err?.message !== "organization_quota_exhausted"
  ) {
    return null;
  }
  const seconds = typeof err.retryAfter === "number" ? err.retryAfter : 3600;
  return new SendDeferredError(
    seconds * 1000 + Math.floor(Math.random() * 600_000),
    err.message,
  );
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
