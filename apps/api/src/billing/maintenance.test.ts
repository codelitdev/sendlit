import { beforeEach, describe, expect, it, mock, vi } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

let releaseDeadline: () => void = () => undefined;
const engine = {
  recordRequestedCatalog: vi.fn(async () => null),
  verifyRequestedCatalog: vi.fn(async () => ({ verified: true, mismatches: [] })),
  runWebhookInboxBatch: vi.fn(async () => 0),
  runReconciliationBatch: vi.fn(async () => 0),
  runDeadlineBatch: vi.fn(
    () =>
      new Promise<number>((resolve) => {
        releaseDeadline = () => resolve(0);
      }),
  ),
  purgeExpiredSensitiveValues: vi.fn(async () => 0),
  getBillableEntityBillingBlockers: vi.fn(async () => []),
};

mock.module("./engine", () => ({
  getBillingEngine: () => engine,
  billingWorkerId: () => "test-billing",
  resetBillingEngine: () => undefined,
}));

const { useCloudFakeBillingEnv } = await import("../test/billing");
const { startBillingMaintenance } = await import("./maintenance");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(check: () => boolean, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition_not_met");
    await sleep(10);
  }
}

beforeEach(() => {
  useCloudFakeBillingEnv();
  for (const fn of Object.values(engine)) fn.mockClear();
});

describe("billing maintenance lifecycle", () => {
  it("does not run a deadline batch at boot, and stop() waits for in-flight work", async () => {
    const startedAt = Date.now();
    const maintenance = startBillingMaintenance({ workerIntervalMs: 250 });
    await Promise.resolve();
    // Only the catalog record runs at start; deadlines wait for the first tick.
    expect(engine.recordRequestedCatalog).toHaveBeenCalledTimes(1);
    expect(engine.runDeadlineBatch).not.toHaveBeenCalled();

    await until(() => engine.runDeadlineBatch.mock.calls.length > 0);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(240);
    expect(engine.runDeadlineBatch).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = maintenance.stop().then(() => {
      stopped = true;
    });
    await sleep(20);
    // The deadline batch is still running, so stop() has not resolved.
    expect(stopped).toBe(false);
    releaseDeadline();
    await stopping;
    expect(stopped).toBe(true);
    const calls = engine.runDeadlineBatch.mock.calls.length;
    await sleep(400);
    expect(engine.runDeadlineBatch.mock.calls.length).toBe(calls);
  });

  it("runs only the send reservation loop in OSS mode", async () => {
    process.env.SENDLIT_DEPLOYMENT_MODE = "oss";
    delete process.env.BILLING_CHECKOUT_PROVIDER;
    delete process.env.BILLING_ENABLED_PROVIDERS;
    const maintenance = startBillingMaintenance({
      workerIntervalMs: 10,
      reservationIntervalMs: 10,
    });
    await sleep(40);
    await maintenance.stop();
    expect(engine.recordRequestedCatalog).not.toHaveBeenCalled();
    expect(engine.runDeadlineBatch).not.toHaveBeenCalled();
    expect(engine.getBillableEntityBillingBlockers).not.toHaveBeenCalled();
  });
});
