import { describe, expect, it } from "bun:test";
import {
  type CommercialStateLike,
  cheapestPlanWith,
  nextPlanUp,
  resolveEntitlements,
} from "./policies";

const state = { teamsLimitOverride: null, contactsLimitOverride: null };
const now = new Date("2026-08-29T00:00:00.000Z");

function commercial(overrides: Partial<CommercialStateLike> = {}): CommercialStateLike {
  return {
    activePaidPlan: "business",
    billingInterval: "month",
    subscriptionStatus: "active",
    providerTrialEndsAt: null,
    currentPeriodEndsAt: new Date("2026-09-29T00:00:00.000Z"),
    paidThroughAt: new Date("2026-09-29T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    pendingCheckout: false,
    pendingPlanChange: false,
    ...overrides,
  };
}

function resolve(value: CommercialStateLike | null, graceEndsAt: Date | null = null) {
  return resolveEntitlements({
    organizationId: "org",
    deploymentMode: "cloud",
    overrides: state,
    commercial: value,
    graceEndsAt,
    now,
  });
}

describe("billing entitlement projection", () => {
  it("takes the paid plan only from the engine's commercial state", () => {
    const paid = resolve(commercial());
    expect(paid).toMatchObject({
      plan: "business",
      interval: "month",
      paymentStatus: "active",
      teamsLimit: 15,
      canSend: true,
    });
    // The engine reports no paid plan once a scheduled cancellation passed
    // its paid-through date, even while the provider still says active.
    const lapsed = resolve(commercial({ activePaidPlan: null }));
    expect(lapsed).toMatchObject({
      plan: "free",
      interval: null,
      paymentStatus: "free",
      teamsLimit: 1,
      cancelAtPeriodEnd: false,
      paidThroughAt: null,
    });
  });

  it("reports a scheduled cancellation with its paid-through date", () => {
    const entitlements = resolve(commercial({ cancelAtPeriodEnd: true }));
    expect(entitlements.plan).toBe("business");
    expect(entitlements.paymentStatus).toBe("cancel_at_period_end");
    expect(entitlements.cancelAtPeriodEnd).toBe(true);
    expect(entitlements.paidThroughAt?.toISOString()).toBe("2026-09-29T00:00:00.000Z");
    // Lemon Squeezy-style "cancelled until period end" maps the same way.
    expect(resolve(commercial({ subscriptionStatus: "cancelled" })).paymentStatus).toBe(
      "cancel_at_period_end",
    );
  });

  it("maps trialing, past_due and a pending checkout", () => {
    expect(resolve(commercial({ subscriptionStatus: "trialing" })).paymentStatus).toBe(
      "trialing",
    );
    expect(
      resolve(commercial({ activePaidPlan: null, pendingCheckout: true }))
        .paymentStatus,
    ).toBe("checkout_pending");
    expect(resolve(null).paymentStatus).toBe("free");
  });

  it("stops sending only after SendLit's past-due grace has ended", () => {
    const pastDue = commercial({ subscriptionStatus: "past_due" });
    const inGrace = resolve(pastDue, new Date("2026-09-01T00:00:00.000Z"));
    expect(inGrace).toMatchObject({ paymentStatus: "past_due", canSend: true });
    const graceOver = resolve(pastDue, new Date("2026-08-28T00:00:00.000Z"));
    expect(graceOver.canSend).toBe(false);
    expect(graceOver.graceEndsAt?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    // A grace date left on an active subscription does not block sending.
    expect(resolve(commercial(), new Date("2026-08-28T00:00:00.000Z")).canSend).toBe(
      true,
    );
  });

  it("applies operator overrides on top of the plan", () => {
    const entitlements = resolveEntitlements({
      organizationId: "org",
      deploymentMode: "cloud",
      overrides: { teamsLimitOverride: 3, contactsLimitOverride: 5_000 },
      commercial: null,
    });
    expect(entitlements).toMatchObject({
      plan: "free",
      teamsLimit: 3,
      subscribedContactsLimit: 5_000,
    });
  });

  it("is unlimited in OSS mode without consulting billing", () => {
    const entitlements = resolveEntitlements({
      organizationId: "org",
      deploymentMode: "oss",
      overrides: null,
      commercial: commercial(),
    });
    expect(entitlements).toMatchObject({ plan: "oss", teamsLimit: null });
  });

  // The hosted plan table from #60: priced on sends and teams, never contacts.
  it.each([
    ["starter", 1, 25_000, true, false, false],
    ["pro", 3, 125_000, false, true, false],
    ["business", 15, 600_000, false, true, true],
  ] as const)(
    "%s: %d teams, %d sends, branding %p, shared mailbox %p, provisioning %p",
    (plan, teams, sends, branding, sharedMailbox, provisioning) => {
      expect(resolve(commercial({ activePaidPlan: plan }))).toMatchObject({
        plan,
        teamsLimit: teams,
        monthlySendsLimit: sends,
        subscribedContactsLimit: null,
        marketingBranding: branding,
        sharedOrganizationMailbox: sharedMailbox,
        provisioning,
        organizationApiKeys: provisioning,
        fairUse: true,
      });
    },
  );

  it("gives Free one team, 3,000 sends, unlimited contacts and the footer", () => {
    expect(resolve(null)).toMatchObject({
      plan: "free",
      teamsLimit: 1,
      monthlySendsLimit: 3_000,
      subscribedContactsLimit: null,
      marketingBranding: true,
      sharedOrganizationMailbox: false,
      provisioning: false,
    });
  });

  it("points limit errors at the next plan up", () => {
    expect(nextPlanUp("free")).toBe("starter");
    expect(nextPlanUp("starter")).toBe("pro");
    expect(nextPlanUp("pro")).toBe("business");
    expect(nextPlanUp("business")).toBe("business");
    expect(cheapestPlanWith("sharedOrganizationMailbox")).toBe("pro");
    expect(cheapestPlanWith("provisioning")).toBe("business");
  });
});
