import { positiveInt } from "../billing/reputation-config";
import { sharedRedis } from "../services/redis-client";

/**
 * Test sends skip billing and the outbound ledger, so they are capped on
 * their own, like Mailchimp's and Omnisend's test limits: every recipient
 * counts once, per team over a rolling day with a shorter burst window, and
 * per email so one email can't be re-sent as tests indefinitely. Counters
 * live in Redis so they hold across restarts and API replicas.
 */
export type TestSendLimits = {
  /** Test recipients per team in any rolling 24 hours. */
  teamDaily: number;
  /** Test recipients per team in any rolling `burstHours`. */
  teamBurst: number;
  burstHours: number;
  /** Test recipients per email in any rolling 24 hours. */
  emailDaily: number;
};

export function readTestSendLimits(): TestSendLimits {
  return {
    teamDaily: positiveInt("TEST_SEND_DAILY_LIMIT", 100),
    teamBurst: positiveInt("TEST_SEND_BURST_LIMIT", 50),
    burstHours: positiveInt("TEST_SEND_BURST_HOURS", 3, 24),
    emailDaily: positiveInt("TEST_SEND_EMAIL_DAILY_LIMIT", 20),
  };
}

export class TestSendLimitError extends Error {
  constructor(
    message: "test_send_limit_reached" | "test_send_email_limit_reached",
    /** Seconds until enough earlier tests age out. */
    readonly retryAfter: number,
  ) {
    super(message);
    this.name = "TestSendLimitError";
  }
}

const DAY_MS = 86_400_000;

// Sliding windows over two sorted sets of send times (one per team, one per
// email). Either all `n` recipients fit every window and are recorded, or
// nothing is recorded and the script returns which window is full and how
// long until enough entries expire.
const TAKE = `
local n = tonumber(ARGV[1])
local teamDaily = tonumber(ARGV[2])
local teamBurst = tonumber(ARGV[3])
local burstMs = tonumber(ARGV[4])
local emailDaily = tonumber(ARGV[5])
local nonce = ARGV[6]
local dayMs = ${DAY_MS}
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - dayMs)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - dayMs)

-- Wait until the entry that must expire for n more to fit has aged out.
local function waitFor(key, since, count, limit, window)
  local over = count + n - limit
  local entry = redis.call('ZRANGEBYSCORE', key, since, '+inf', 'WITHSCORES', 'LIMIT', over - 1, 1)
  if entry[2] == nil then return window end
  return tonumber(entry[2]) + window - now
end

local daily = redis.call('ZCARD', KEYS[1])
if daily + n > teamDaily then
  return {1, waitFor(KEYS[1], now - dayMs, daily, teamDaily, dayMs)}
end
local burst = redis.call('ZCOUNT', KEYS[1], now - burstMs, '+inf')
if burst + n > teamBurst then
  return {1, waitFor(KEYS[1], now - burstMs, burst, teamBurst, burstMs)}
end
local email = redis.call('ZCARD', KEYS[2])
if email + n > emailDaily then
  return {2, waitFor(KEYS[2], now - dayMs, email, emailDaily, dayMs)}
end
for i = 1, n do
  redis.call('ZADD', KEYS[1], now, nonce .. ':' .. i)
  redis.call('ZADD', KEYS[2], now, nonce .. ':' .. i)
end
redis.call('PEXPIRE', KEYS[1], dayMs)
redis.call('PEXPIRE', KEYS[2], dayMs)
return {0, 0}
`;

/**
 * Records `recipients` test sends for the team and email, or throws
 * `TestSendLimitError` (`test_send_limit_reached` for the team's windows,
 * `test_send_email_limit_reached` for the email's) without recording any.
 */
export async function takeTestSendQuota(input: {
  teamId: string;
  emailId: string;
  recipients: number;
  limits?: TestSendLimits;
}): Promise<void> {
  if (input.recipients <= 0) return;
  const limits = input.limits ?? readTestSendLimits();
  const [outcome, waitMs] = (await sharedRedis().eval(
    TAKE,
    2,
    `sendlit:test-sends:team:${input.teamId}`,
    `sendlit:test-sends:email:${input.emailId}`,
    input.recipients,
    limits.teamDaily,
    limits.teamBurst,
    limits.burstHours * 3_600_000,
    limits.emailDaily,
    crypto.randomUUID(),
  )) as [number, number];
  if (outcome === 0) return;
  throw new TestSendLimitError(
    outcome === 1 ? "test_send_limit_reached" : "test_send_email_limit_reached",
    Math.max(1, Math.ceil(waitMs / 1000)),
  );
}
