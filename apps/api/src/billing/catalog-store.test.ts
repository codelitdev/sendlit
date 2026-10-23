import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("../db/client", async () => {
  const { makeTestDb } = await import("../test/db.js");
  return { db: await makeTestDb() };
});

const { db } = await import("../db/client");
const { truncateAll } = await import("../test/db");
const { activateFakeCatalog, fakeProvider, useCloudFakeBillingEnv } = await import(
  "../test/billing"
);
type TestDb = import("../test/db").TestDb;
const { readBillingConfig } = await import("./catalog");
const { getPublicCatalog, recordRequestedCatalogRevision, requirePublicCatalog } =
  await import("./catalog-store");
const { getBillingEngine } = await import("./engine");
const { resetBillingProviderInstances } = await import("./provider-registry");

const tdb = db as unknown as TestDb;

beforeEach(async () => {
  useCloudFakeBillingEnv();
  resetBillingProviderInstances();
  await truncateAll(tdb);
});

describe("catalog verification against the fake adapter", () => {
  it("activates a six-offer revision when products match", async () => {
    await activateFakeCatalog();
    const active = await getPublicCatalog(readBillingConfig());
    expect(active.revision).toBe(1);
    expect(active.offers).toHaveLength(6);
    expect(active.checkoutAvailable).toBe(true);
    await expect(
      requirePublicCatalog(readBillingConfig(), "pro_month"),
    ).resolves.toMatchObject({ revision: 1 });
  });

  it("does not activate on a provider amount mismatch", async () => {
    const provider = await fakeProvider();
    provider.seedProduct({
      provider: "fake",
      providerProductId: "pdt_pro_month",
      currency: "USD",
      amountMinor: 9900,
      interval: "month",
    });
    await recordRequestedCatalogRevision(readBillingConfig());
    const result = await getBillingEngine().verifyRequestedCatalog();
    expect(result.verified).toBe(false);
    await expect(getPublicCatalog(readBillingConfig())).rejects.toThrow(
      /billing_catalog_unavailable/,
    );
  });

  it("reports a changed catalog when another revision is requested", async () => {
    await activateFakeCatalog();
    process.env.BILLING_CATALOG_REVISION = "2";
    await expect(
      requirePublicCatalog(readBillingConfig(), "pro_month"),
    ).rejects.toThrow("billing_catalog_changed");
  });
});
