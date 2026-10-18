import { describe, expect, it } from "vitest";
import { resolveEntitlements } from "./policies";

const state = {
    plan: "business" as const,
    teamsLimitOverride: null,
    contactsLimitOverride: null,
};

describe("billing entitlement projection", () => {
    it("keeps a cancelled subscription paid only through its verified deadline", () => {
        const now = new Date("2026-08-29T00:00:00.000Z");
        const base = {
            plan: "business" as const,
            billingInterval: "month" as const,
            currentPeriodEndsAt: new Date("2026-09-29T00:00:00.000Z"),
            trialEndsAt: null,
            graceEndsAt: null,
            cancelAtPeriodEnd: true,
        };
        expect(
            resolveEntitlements({
                organizationId: "org",
                deploymentMode: "cloud",
                planState: state,
                subscription: {
                    ...base,
                    status: "cancelled",
                    paidThroughAt: new Date("2026-09-29T00:00:00.000Z"),
                },
                now,
            }).plan,
        ).toBe("business");
        expect(
            resolveEntitlements({
                organizationId: "org",
                deploymentMode: "cloud",
                planState: state,
                subscription: {
                    ...base,
                    status: "cancelled",
                    paidThroughAt: new Date("2026-08-28T00:00:00.000Z"),
                },
                now,
            }).paymentStatus,
        ).toBe("expired");
    });

    it("removes paid access immediately when cancellation is not scheduled for period end", () => {
        const entitlements = resolveEntitlements({
            organizationId: "org",
            deploymentMode: "cloud",
            planState: state,
            subscription: {
                plan: "business",
                billingInterval: "month",
                status: "cancelled",
                currentPeriodEndsAt: new Date("2026-09-29T00:00:00.000Z"),
                paidThroughAt: new Date("2026-09-29T00:00:00.000Z"),
                trialEndsAt: null,
                graceEndsAt: null,
                cancelAtPeriodEnd: false,
            },
            now: new Date("2026-08-29T00:00:00.000Z"),
        });

        expect(entitlements.plan).toBe("free");
        expect(entitlements.paymentStatus).toBe("expired");
        expect(entitlements.teamsLimit).toBe(1);
    });

    it("resolves to Free when there is no entitlement-bearing subscription", () => {
        const entitlements = resolveEntitlements({
            organizationId: "org",
            deploymentMode: "cloud",
            planState: state,
            subscription: null,
        });
        expect(entitlements.plan).toBe("free");
        expect(entitlements.teamsLimit).toBe(1);
    });
});
