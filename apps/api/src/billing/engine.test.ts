import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { truncateAll } = await import("../test/db");
const { useCloudFakeBillingEnv } = await import("../test/billing");
type TestDb = import("../test/db").TestDb;
const {
  getBillingActionGrants,
  getBillingSensitiveValues,
  getPendingCheckoutResumeGrants,
  recentAuthMaxAgeMs,
} = await import("./engine");

const tdb = db as unknown as TestDb;
const context = { operatorActorId: "test", reason: "test" };

/** The ciphertext format SendLit's removed `crypto.ts` wrote. */
function legacyEncrypt(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64"))
    .join(".");
}

beforeEach(async () => {
  useCloudFakeBillingEnv();
  await truncateAll(tdb);
});

describe("billing sensitive values", () => {
  it("reads values SendLit encrypted before the migration, including the previous key", async () => {
    const current = Buffer.alloc(32, 7);
    const previous = Buffer.alloc(32, 8);
    process.env.BILLING_DATA_ENCRYPTION_KEY = current.toString("base64");
    process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS = previous.toString("base64");
    const values = getBillingSensitiveValues();
    await expect(
      values.decrypt(legacyEncrypt("checkout url", current), context),
    ).resolves.toBe("checkout url");
    await expect(
      values.decrypt(legacyEncrypt("rotated", previous), context),
    ).resolves.toBe("rotated");
    const written = await values.encrypt("round trip");
    expect(
      written.ciphertext.split(".").map((part) => Buffer.from(part, "base64").length),
    ).toEqual([12, 16, 10]);
    delete process.env.BILLING_DATA_ENCRYPTION_KEY_PREVIOUS;
  });

  it("keeps the configured key version and rejects malformed keys", async () => {
    process.env.BILLING_DATA_ENCRYPTION_KEY_VERSION = "v3";
    expect((await getBillingSensitiveValues().encrypt("x")).keyVersion).toBe("v3");
    delete process.env.BILLING_DATA_ENCRYPTION_KEY_VERSION;
    process.env.BILLING_DATA_ENCRYPTION_KEY = "a".repeat(32);
    expect(() => getBillingSensitiveValues()).toThrow("must_be_32_bytes");
    process.env.BILLING_DATA_ENCRYPTION_KEY = "not base64!";
    expect(() => getBillingSensitiveValues()).toThrow("must_be_base64");
    delete process.env.BILLING_DATA_ENCRYPTION_KEY;
    expect(() => getBillingSensitiveValues()).toThrow(
      "BILLING_DATA_ENCRYPTION_KEY_missing",
    );
  });
});

describe("billing action grants", () => {
  it("maps BILLING_RECENT_AUTH_MAX_AGE_SECONDS and fails closed on bad values", () => {
    expect(recentAuthMaxAgeMs({ BILLING_RECENT_AUTH_MAX_AGE_SECONDS: "60" })).toBe(
      60_000,
    );
    expect(recentAuthMaxAgeMs({})).toBe(900_000);
    expect(recentAuthMaxAgeMs({ BILLING_RECENT_AUTH_MAX_AGE_SECONDS: "0" })).toBeNull();
    expect(
      recentAuthMaxAgeMs({ BILLING_RECENT_AUTH_MAX_AGE_SECONDS: "1.5" }),
    ).toBeNull();
  });

  it("lets the engine port consume a pending-checkout grant issued to an old session", async () => {
    const target = { kind: "organization", id: crypto.randomUUID() };
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const strict = await getBillingActionGrants().issue({
      actorId: "user-1",
      sessionId: "session-1",
      sessionCreatedAt: old,
      action: "checkout",
      target,
    });
    expect(strict).toEqual({ ok: false, error: "recent_authentication_required" });

    const lenient = getPendingCheckoutResumeGrants();
    const issued = await lenient.issue({
      actorId: "user-1",
      sessionId: "session-1",
      sessionCreatedAt: old,
      action: "checkout",
      target,
    });
    if (!issued.ok) throw new Error("grant_not_issued");
    const engineGrants = getBillingActionGrants();
    const grant = engineGrants.grant({
      token: issued.token,
      actorId: "user-1",
      sessionId: "session-1",
      action: "checkout",
      target,
    });
    await expect(
      engineGrants.authorization.consume(grant, "checkout", target, new Date()),
    ).resolves.toBeUndefined();
  });
});
