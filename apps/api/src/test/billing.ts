import { eq } from "drizzle-orm";
import { resetBillingEngine } from "../billing/engine";
import type { FakeBillingProvider } from "../billing/providers/fake";
import * as schema from "../db/schema";
import type { TestDb } from "./db";

/**
 * Cloud billing env with the in-memory fake provider (never Dodo). Call in
 * `beforeEach`, then `activateFakeCatalog()` when a test needs an active
 * catalog. Pair with the PGlite `db` mock from `./db`.
 */
const CLOUD_FAKE_ENV = {
  SENDLIT_DEPLOYMENT_MODE: "cloud",
  BILLING_CHECKOUT_PROVIDER: "fake",
  BILLING_ENABLED_PROVIDERS: "fake",
  BILLING_CATALOG_REVISION: "1",
  BILLING_CURRENCY: "USD",
  BILLING_STARTER_MONTH_AMOUNT_MINOR: "1000",
  BILLING_STARTER_YEAR_AMOUNT_MINOR: "10000",
  BILLING_PRO_MONTH_AMOUNT_MINOR: "4900",
  BILLING_PRO_YEAR_AMOUNT_MINOR: "49000",
  BILLING_BUSINESS_MONTH_AMOUNT_MINOR: "19900",
  BILLING_BUSINESS_YEAR_AMOUNT_MINOR: "199000",
  FAKE_STARTER_MONTH_PRODUCT_ID: "pdt_starter_month",
  FAKE_STARTER_YEAR_PRODUCT_ID: "pdt_starter_year",
  FAKE_PRO_MONTH_PRODUCT_ID: "pdt_pro_month",
  FAKE_PRO_YEAR_PRODUCT_ID: "pdt_pro_year",
  FAKE_BUSINESS_MONTH_PRODUCT_ID: "pdt_business_month",
  FAKE_BUSINESS_YEAR_PRODUCT_ID: "pdt_business_year",
  BILLING_TRIAL_EMAIL_HMAC_KEY: "trial-hmac-secret-with-at-least-32-bytes",
  BILLING_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  BILLING_RECENT_AUTH_MAX_AGE_SECONDS: "900",
  WEB_CLIENT: "http://localhost:3000",
  API_PUBLIC_URL: "http://localhost:5000",
};

export function useCloudFakeBillingEnv(): void {
  Object.assign(process.env, CLOUD_FAKE_ENV);
  resetBillingEngine();
}

/** Back to the OSS default from `setup.ts`. */
export function clearCloudFakeBillingEnv(): void {
  for (const key of Object.keys(CLOUD_FAKE_ENV)) delete process.env[key];
  process.env.SENDLIT_DEPLOYMENT_MODE = "oss";
  process.env.BILLING_TRIAL_EMAIL_HMAC_KEY =
    "test-trial-hmac-key-with-at-least-32-bytes";
  resetBillingEngine();
}

/** The fake adapter the engine uses (one per process, see provider-registry). */
export async function fakeProvider(): Promise<FakeBillingProvider> {
  const { getBillingProvider } = await import("../billing/provider-registry");
  return getBillingProvider("fake") as FakeBillingProvider;
}

/** Records and verifies revision 1 against the fake provider's products. */
export async function activateFakeCatalog(): Promise<void> {
  const { getBillingEngine } = await import("../billing/engine");
  const billing = getBillingEngine();
  await billing.recordRequestedCatalog();
  const verified = await billing.verifyRequestedCatalog();
  if (!verified.verified) {
    throw new Error(`fake catalog not verified: ${verified.mismatches.join(",")}`);
  }
}

/**
 * A paid subscription that is the organization's entitlement source, both in
 * the fake provider and in the billing tables. Requires an active catalog.
 */
export async function seedPaidSubscription(
  db: TestDb,
  input: {
    organizationId: string;
    payerId: string;
    offerKey?: import("@sendlit/api-contract").BillingCatalogKey;
    status?: "trialing" | "active" | "past_due" | "cancelled";
    cancelAtPeriodEnd?: boolean;
    paidThroughAt?: Date;
    /** Recorded on SendLit's plan policy, as the projection hook does. */
    pastDueSince?: Date | null;
  },
) {
  const offerKey = input.offerKey ?? "pro_month";
  const [price] = await db
    .select()
    .from(schema.billingPriceEntries)
    .where(eq(schema.billingPriceEntries.offerKey, offerKey))
    .limit(1);
  if (!price) throw new Error("activateFakeCatalog first");
  const provider = await fakeProvider();
  const providerCustomer = await provider.createCustomer({
    email: `${input.payerId}@example.com`,
    name: "Payer",
    idempotencyKey: `customer:fake:${input.payerId}`,
  });
  const remote = provider.createExternalSubscription({
    customerId: providerCustomer.providerCustomerId,
    productId: price.providerProductId,
  });
  // Defaults to the provider's own period end, so a read-back agrees.
  const paidThroughAt = input.paidThroughAt ?? remote.paidThroughAt ?? new Date();
  const [customer] = await db
    .insert(schema.billingProviderCustomers)
    .values({
      provider: "fake",
      payerId: input.payerId,
      providerCustomerId: providerCustomer.providerCustomerId,
      idempotencyKey: `customer:fake:${input.payerId}`,
      status: "active",
    })
    .onConflictDoNothing()
    .returning();
  const customerId =
    customer?.id ??
    (
      await db
        .select({ id: schema.billingProviderCustomers.id })
        .from(schema.billingProviderCustomers)
        .where(eq(schema.billingProviderCustomers.payerId, input.payerId))
        .limit(1)
    )[0]!.id;
  const [subscription] = await db
    .insert(schema.billingSubscriptions)
    .values({
      billableEntityId: input.organizationId,
      billingCustomerId: customerId,
      payerId: input.payerId,
      provider: "fake",
      providerSubscriptionId: remote.providerSubscriptionId,
      providerProductId: price.providerProductId,
      billingPriceEntryId: price.id,
      catalogRevision: 1,
      offerKey,
      plan: price.plan,
      billingInterval: price.billingInterval,
      status: input.status ?? "active",
      currentPeriodEndsAt: paidThroughAt,
      paidThroughAt,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      isEntitlementSource: true,
      providerVersion: "1",
      lastReconciledAt: new Date(),
    })
    .returning();
  // Stands in for the engine's projection, which creates the plan state.
  await db
    .insert(schema.billingPlanStates)
    .values({
      billableEntityId: input.organizationId,
      activeSubscriptionId: subscription!.id,
    })
    .onConflictDoUpdate({
      target: schema.billingPlanStates.billableEntityId,
      set: { activeSubscriptionId: subscription!.id },
    });
  if (input.pastDueSince !== undefined) {
    await db
      .insert(schema.organizationPlanPolicies)
      .values({
        organizationId: input.organizationId,
        pastDueSince: input.pastDueSince,
      })
      .onConflictDoUpdate({
        target: schema.organizationPlanPolicies.organizationId,
        set: { pastDueSince: input.pastDueSince },
      });
  }
  return { subscription: subscription!, remote, price };
}
