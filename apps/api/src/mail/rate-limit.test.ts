import { afterAll, describe, expect, it, mock } from "bun:test";
import Redis from "ioredis";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const redisConfig = (await import("../services/redis")).default;
const {
  closeSendRateLimiter,
  effectiveMaxSendRate,
  SendDeferredError,
  throttlingRetryDelay,
  waitForSendSlot,
} = await import("./rate-limit");

async function redisAvailable() {
  const probe = new Redis({
    ...redisConfig,
    lazyConnect: true,
    connectTimeout: 500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

// CI runs a Redis service (see .github/workflows/test.yaml). Locally, set
// REDIS_HOST/REDIS_PORT to a Redis to run these.
const hasRedis = await redisAvailable();

afterAll(closeSendRateLimiter);

describe("send rate limit", () => {
  it.skipIf(!hasRedis)(
    "spaces sends through one ESP across concurrent callers",
    async () => {
      const esp = `test-${crypto.randomUUID()}`;
      const rate = 20; // one send every 50ms
      await waitForSendSlot(`warm-up-${crypto.randomUUID()}`, rate);
      const started = Date.now();
      const sentAt = await Promise.all(
        Array.from({ length: 10 }, async () => {
          await waitForSendSlot(esp, rate);
          return Date.now() - started;
        }),
      );
      sentAt.sort((a, b) => a - b);

      // Ten slots 50ms apart: send i can't go before i * 50ms after the first.
      for (let i = 1; i < sentAt.length; i++) {
        expect(sentAt[i] - sentAt[0]).toBeGreaterThanOrEqual(i * 50 - 15);
      }
      // A different ESP has its own budget.
      const other = Date.now();
      await waitForSendSlot(`test-${crypto.randomUUID()}`, rate);
      expect(Date.now() - other).toBeLessThan(40);
    },
  );

  it.skipIf(!hasRedis)("defers instead of waiting past the cap", async () => {
    const esp = `test-${crypto.randomUUID()}`;
    await waitForSendSlot(esp, 1, { maxWaitMs: 500 });
    const deferred = await waitForSendSlot(esp, 1, { maxWaitMs: 500 }).catch((e) => e);
    expect(deferred).toBeInstanceOf(SendDeferredError);
    expect(deferred.retryAfterMs).toBeGreaterThan(500);
    expect(deferred.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it("uses the configured rate, else the provider default", () => {
    expect(effectiveMaxSendRate({ provider: "ses", maxSendRate: null })).toBe(14);
    expect(effectiveMaxSendRate({ provider: "ses", maxSendRate: 50 })).toBe(50);
    expect(effectiveMaxSendRate({ provider: "resend", maxSendRate: null })).toBe(2);
    expect(effectiveMaxSendRate({ provider: "smtp", maxSendRate: null })).toBeNull();
  });

  it("recognises throttling replies, not rejections", () => {
    expect(
      throttlingRetryDelay({
        responseCode: 454,
        message: "454 Throttling failure: Maximum sending rate exceeded.",
      }),
    ).toBe(60_000);
    expect(
      throttlingRetryDelay({
        responseCode: 454,
        message: "454 Throttling failure: Daily message quota exceeded.",
      }),
    ).toBe(15 * 60_000);
    expect(throttlingRetryDelay({ responseCode: 421, message: "try later" })).toBe(
      60_000,
    );
    expect(
      throttlingRetryDelay({ responseCode: 550, message: "No such user" }),
    ).toBeNull();
    expect(throttlingRetryDelay(new Error("ECONNRESET"))).toBeNull();
  });
});
