import { afterAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import Redis from "ioredis";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const redisConfig = (await import("../services/redis")).default;
const {
  acquireEspSendCapacity,
  closeSendRateLimiter,
  dailySendCount,
  effectiveMaxSendRate,
  quotaExhaustionDeferral,
  reserveDailySend,
  SendDeferredError,
  throttlingRetryDelay,
  untilNextUtcDay,
  waitForSendSlot,
} = await import("./rate-limit");
const { db } = await import("../db/client");
const { espConfigs } = await import("../db/schema");
const { seedTeamAndContact } = await import("../test/db");
type TestDb = import("../test/db").TestDb;

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

      // Ten slots 50ms apart, so the last can't go before 450ms. (Gaps
      // between single sends aren't checked: on a busy machine a caller can
      // resume late and land next to the following one.)
      expect(sentAt.at(-1)!).toBeGreaterThanOrEqual(9 * 50 - 15);
      expect(sentAt.filter((at) => at < 100).length).toBeLessThanOrEqual(2);
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

  it.skipIf(!hasRedis)(
    "caps marketing sends per UTC day until a send is given back",
    async () => {
      const esp = `test-${crypto.randomUUID()}`;
      await reserveDailySend(esp, 2);
      const release = await reserveDailySend(esp, 2);
      const capped = await reserveDailySend(esp, 2).catch((e) => e);
      expect(capped).toBeInstanceOf(SendDeferredError);
      expect(capped.message).toBe("daily_send_limit_reached");
      expect(await dailySendCount(esp)).toBe(2);

      await release();
      await expect(reserveDailySend(esp, 2)).resolves.toBeInstanceOf(Function);
    },
  );

  it.skipIf(!hasRedis)(
    "applies an ESP's daily cap to marketing mail only",
    async () => {
      const tdb = db as unknown as TestDb;
      const { team } = await seedTeamAndContact(tdb, {
        espConfig: { dailySendLimit: 1, provider: "smtp" },
      });
      const [esp] = await tdb
        .select()
        .from(espConfigs)
        .where(eq(espConfigs.teamId, team.id));

      await acquireEspSendCapacity(esp.id, "campaign");
      const capped = await acquireEspSendCapacity(esp.id, "campaign").catch((e) => e);
      expect(capped).toBeInstanceOf(SendDeferredError);
      await expect(
        acquireEspSendCapacity(esp.id, "transactional"),
      ).resolves.toBeInstanceOf(Function);
    },
  );

  it.skipIf(!hasRedis)(
    "caps marketing mail at the warm-up's limit for the day",
    async () => {
      const tdb = db as unknown as TestDb;
      // Day 2 of a warm-up to 1,000 a day: 100 today, below the ESP's own 500.
      const { team } = await seedTeamAndContact(tdb, {
        espConfig: {
          provider: "smtp",
          dailySendLimit: 500,
          warmupTargetDaily: 1_000,
          warmupStartedAt: new Date(Date.now() - 86_400_000),
        },
      });
      const [esp] = await tdb
        .select()
        .from(espConfigs)
        .where(eq(espConfigs.teamId, team.id));
      for (let i = 0; i < 100; i++) await acquireEspSendCapacity(esp.id, "campaign");
      const capped = await acquireEspSendCapacity(esp.id, "campaign").catch((e) => e);
      expect(capped).toBeInstanceOf(SendDeferredError);
      expect(await dailySendCount(esp.id)).toBe(100);
    },
  );

  it("defers to just after midnight UTC, or when an organization quota resets", () => {
    const now = new Date("2026-10-19T23:00:00Z");
    const wait = untilNextUtcDay(now);
    expect(wait).toBeGreaterThanOrEqual(3_600_000);
    expect(wait).toBeLessThan(3_600_000 + 600_000);

    const quota = quotaExhaustionDeferral(
      Object.assign(new Error("organization_team_quota_exhausted"), {
        retryAfter: 120,
      }),
    );
    expect(quota?.retryAfterMs).toBeGreaterThanOrEqual(120_000);
    expect(quotaExhaustionDeferral(new Error("smtp down"))).toBeNull();
    const ramp = quotaExhaustionDeferral(
      Object.assign(new Error("plan_limit_reached"), {
        details: { capability: "marketing_daily_ramp" },
      }),
    );
    expect(ramp?.message).toBe("marketing_daily_ramp");
    expect(
      quotaExhaustionDeferral(
        Object.assign(new Error("plan_limit_reached"), {
          details: { capability: "monthly_sends" },
        }),
      ),
    ).toBeNull();
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
