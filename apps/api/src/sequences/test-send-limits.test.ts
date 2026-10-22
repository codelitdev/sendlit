import { afterAll, describe, expect, it } from "bun:test";
import Redis from "ioredis";

const redisConfig = (await import("../services/redis")).default;
const { closeSharedRedis } = await import("../services/redis-client");
const { readTestSendLimits, takeTestSendQuota, TestSendLimitError } = await import(
  "./test-send-limits"
);

async function redisAvailable() {
  const probe = new Redis({
    ...redisConfig,
    lazyConnect: true,
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

// CI runs a Redis service. Locally, set REDIS_HOST/REDIS_PORT to run these.
const hasRedis = await redisAvailable();
const limits = { teamDaily: 6, teamBurst: 4, burstHours: 3, emailDaily: 3 };
const ids = () => ({ teamId: crypto.randomUUID(), emailId: crypto.randomUUID() });

afterAll(closeSharedRedis);

describe("test send limits", () => {
  it("defaults to 100 a day, 50 in 3 hours and 20 per email", () => {
    expect(readTestSendLimits()).toEqual({
      teamDaily: 100,
      teamBurst: 50,
      burstHours: 3,
      emailDaily: 20,
    });
  });

  it.skipIf(!hasRedis)("caps tests per email, all or nothing", async () => {
    const { teamId, emailId } = ids();
    await takeTestSendQuota({ teamId, emailId, recipients: 2, limits });
    const error = await takeTestSendQuota({
      teamId,
      emailId,
      recipients: 2,
      limits,
    }).catch((err) => err);
    expect(error).toBeInstanceOf(TestSendLimitError);
    expect(error.message).toBe("test_send_email_limit_reached");
    expect(error.retryAfter).toBeGreaterThan(86_000);
    // Nothing was recorded, so one more still fits.
    await takeTestSendQuota({ teamId, emailId, recipients: 1, limits });
  });

  it.skipIf(!hasRedis)("caps a team's burst across its emails", async () => {
    const { teamId } = ids();
    await takeTestSendQuota({
      teamId,
      emailId: crypto.randomUUID(),
      recipients: 3,
      limits,
    });
    const error = await takeTestSendQuota({
      teamId,
      emailId: crypto.randomUUID(),
      recipients: 2,
      limits,
    }).catch((err) => err);
    expect(error.message).toBe("test_send_limit_reached");
    // The burst window is 3 hours, so the wait is under that.
    expect(error.retryAfter).toBeLessThanOrEqual(3 * 3_600);
    expect(error.retryAfter).toBeGreaterThan(3 * 3_600 - 60);
  });

  it.skipIf(!hasRedis)("caps a team's rolling day", async () => {
    const { teamId } = ids();
    const wide = { ...limits, teamBurst: 100, emailDaily: 100 };
    const emailB = crypto.randomUUID();
    await takeTestSendQuota({
      teamId,
      emailId: crypto.randomUUID(),
      recipients: 5,
      limits: wide,
    });
    await expect(
      takeTestSendQuota({ teamId, emailId: emailB, recipients: 2, limits: wide }),
    ).rejects.toThrow("test_send_limit_reached");
    await takeTestSendQuota({ teamId, emailId: emailB, recipients: 1, limits: wide });
  });
});
