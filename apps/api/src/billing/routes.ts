import { and, eq } from "drizzle-orm";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { db } from "../db/client";
import {
    billingPlanChangeAttempts,
    billingPlanStates,
    billingSubscriptions,
} from "../db/schema";
import { readBillingConfig, type BillingOffer } from "./catalog";
import { checkoutIsAvailable, getActiveCatalog } from "./catalog-store";

import { getOrganizationEntitlements } from "./entitlements";
import {
    BillingCheckoutError,
    createOrganizationCheckout,
    createPaidOrganizationCheckout,
} from "./checkout";
import { createOrganizationPortal } from "./portal";
import {
    BillingPlanChangeError,
    createOrganizationPlanChange,
    getOrganizationPlanChange,
} from "./plan-change";
import { usageForOrganization } from "./usage";
import {
    getOrganizationByPublicId,
    getOrganizationMembership,
} from "../organization/queries";
import {
    billingMutationOrigin,
    ensureCsrfCookie,
    issueBillingActionToken,
    readBillingActionToken,
    requireBillingAction,
    type BillingAction,
} from "./security";
import type { BillingActionGrant } from "@codelitdev/billing/workflows";

const router = Router();
const s = initServer();
let publicCatalogCache: {
    revision: number;
    expiresAt: number;
    offers: ReturnType<typeof readBillingConfig>["offers"];
} | null = null;

const catalogLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests" },
});

function billingError(error: BillingCheckoutError) {
    return {
        status: error.status,
        body: { error: error.code, ...error.details },
    } as any;
}

function planChangeError(error: BillingPlanChangeError) {
    return {
        status: error.status,
        body: { error: error.code, ...error.details },
    } as any;
}

async function authorizeOrganization(req: any, publicId: string) {
    if (!req.userId || !["session", "oauth"].includes(req.authKind)) {
        return null;
    }
    const organization = await getOrganizationByPublicId(publicId);
    if (!organization) return null;
    const membership = await getOrganizationMembership(
        organization.id,
        req.userId,
    );
    return membership ? { organization, membership } : null;
}

const impl = s.router(contract.billing, {
    actionToken: async ({
        req,
        body,
    }: {
        req: any;
        body: { action: BillingAction; target: string };
    }) => {
        const result = await issueBillingActionToken(
            req,
            req.res,
            body.action,
            body.target,
        );
        if ("status" in result) return result as any;
        return { status: 201, body: result };
    },
    organizationCheckout: async ({ req, body }: { req: any; body: any }) => {
        const boundary = await requireBillingAction(
            req,
            req.res,
            "organization_checkout",
            "new",
        );
        if (boundary) return boundary as any;
        try {
            const result = await createPaidOrganizationCheckout({
                payerId: req.userId,
                organizationName: body.organizationName,
                teamName: body.teamName,
                plan: body.plan,
                interval: body.interval,
                catalogRevision: body.catalogRevision,
            });
            return { status: 201, body: result };
        } catch (error) {
            if (error instanceof BillingCheckoutError)
                return billingError(error);
            throw error;
        }
    },
    catalog: async ({ req }: { req: any }) => {
        try {
            const config = readBillingConfig();
            let offers = config.offers;
            let activeRevision = config.catalogRevision;
            if (config.deploymentMode === "cloud") {
                const cached =
                    publicCatalogCache &&
                    publicCatalogCache.expiresAt > Date.now()
                        ? publicCatalogCache
                        : null;
                if (cached) {
                    offers = cached.offers;
                    activeRevision = cached.revision;
                } else {
                    const active = await getActiveCatalog(config);
                    offers = active.items.map(({ offerKey, price }) => ({
                        catalogKey: offerKey as BillingOffer["catalogKey"],
                        catalogRevision: active.revision.revision,
                        plan: price.plan as "pro" | "business",
                        interval: price.billingInterval as "month" | "year",
                        currency: price.currency,
                        amountMinor: price.amountMinor,
                        provider: price.provider,
                        providerProductId: price.providerProductId,
                        trialDays:
                            config.offers.find(
                                (offer) => offer.catalogKey === offerKey,
                            )?.trialDays ?? 0,
                    }));
                    activeRevision = active.revision.revision;
                    publicCatalogCache = {
                        revision: active.revision.revision,
                        expiresAt: Date.now() + 5 * 60 * 1000,
                        offers,
                    };
                }
            }
            const etag = `W/\"billing-${activeRevision ?? "oss"}\"`;
            req.res?.setHeader?.("Cache-Control", "public, max-age=300");
            req.res?.setHeader?.("ETag", etag);
            if (req.headers?.["if-none-match"] === etag)
                return { status: 304, body: undefined } as any;
            return {
                status: 200,
                body: {
                    catalogRevision: activeRevision,
                    currency: offers[0]?.currency ?? config.currency,
                    offers: offers.map(
                        ({
                            catalogKey,
                            plan,
                            interval,
                            currency,
                            amountMinor,
                            trialDays,
                        }) => ({
                            catalogKey,
                            plan,
                            interval,
                            currency,
                            amountMinor,
                            trialDays,
                        }),
                    ),
                    checkoutAvailable: checkoutIsAvailable(
                        config,
                        activeRevision,
                    ),
                },
            };
        } catch {
            return {
                status: 503,
                body: { error: "billing_catalog_unavailable" },
            };
        }
    },
    organizationBilling: async ({ req, params }) => {
        const authorization = await authorizeOrganization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const [planState] = await db
            .select()
            .from(billingPlanStates)
            .where(
                eq(
                    billingPlanStates.billableEntityId,
                    authorization.organization.id,
                ),
            )
            .limit(1);
        const [state] = planState?.activeSubscriptionId
            ? await db
                  .select()
                  .from(billingSubscriptions)
                  .where(
                      eq(
                          billingSubscriptions.id,
                          planState.activeSubscriptionId,
                      ),
                  )
                  .limit(1)
            : [];
        const [pendingPlanChange] = await db
            .select({
                changeId: billingPlanChangeAttempts.changeId,
                targetPlan: billingPlanChangeAttempts.targetPlan,
                targetInterval: billingPlanChangeAttempts.targetInterval,
                effectiveAt: billingPlanChangeAttempts.effectiveAt,
            })
            .from(billingPlanChangeAttempts)
            .where(
                and(
                    eq(
                        billingPlanChangeAttempts.billableEntityId,
                        authorization.organization.id,
                    ),
                    eq(billingPlanChangeAttempts.status, "pending"),
                ),
            )
            .limit(1);
        const entitlements = await getOrganizationEntitlements(
            authorization.organization.id,
        );
        const usage = await usageForOrganization(authorization.organization.id);
        const billingManager = state?.payerId ?? null;
        return {
            status: 200,
            body: {
                plan: entitlements.plan,
                billingInterval: entitlements.interval,
                paymentStatus: entitlements.paymentStatus,
                trialEndsAt: state?.trialEndsAt?.toISOString() ?? null,
                currentPeriodEndsAt:
                    state?.currentPeriodEndsAt?.toISOString() ?? null,
                cancelAtPeriodEnd: state?.cancelAtPeriodEnd ?? false,
                graceEndsAt: entitlements.graceEndsAt?.toISOString() ?? null,
                canManageBilling:
                    authorization.membership.role === "owner" &&
                    (!billingManager || billingManager === (req as any).userId),
                entitlements: {
                    teamsLimit: entitlements.teamsLimit,
                    subscribedContactsLimit:
                        entitlements.subscribedContactsLimit,
                    monthlySendsLimit: entitlements.monthlySendsLimit,
                    sharedOrganizationMailbox:
                        entitlements.sharedOrganizationMailbox,
                    provisioning: entitlements.provisioning,
                    organizationApiKeys: entitlements.organizationApiKeys,
                    marketingBranding: entitlements.marketingBranding,
                },
                usage: {
                    ...usage,
                    plan: entitlements.plan,
                    paymentStatus: entitlements.paymentStatus,
                    teamsLimit: entitlements.teamsLimit,
                    subscribedContactsLimit:
                        entitlements.subscribedContactsLimit,
                    monthlySendsLimit: entitlements.monthlySendsLimit,
                },
                pendingPlanChange: pendingPlanChange
                    ? {
                          changeId: pendingPlanChange.changeId,
                          targetPlan: pendingPlanChange.targetPlan as
                              "pro" | "business",
                          targetInterval: pendingPlanChange.targetInterval as
                              "month" | "year",
                          effectiveAt: pendingPlanChange.effectiveAt as
                              "immediately" | "next_billing_date",
                      }
                    : null,
            },
        };
    },
    organizationPlanUsage: async ({ req, params }) => {
        const authorization = await authorizeOrganization(
            req,
            params.organizationId,
        );
        if (!authorization) {
            return { status: 404, body: { error: "organization_not_found" } };
        }
        const entitlements = await getOrganizationEntitlements(
            authorization.organization.id,
        );
        return {
            status: 200,
            body: {
                ...(await usageForOrganization(authorization.organization.id)),
                plan: entitlements.plan,
                paymentStatus: entitlements.paymentStatus,
                teamsLimit: entitlements.teamsLimit,
                subscribedContactsLimit: entitlements.subscribedContactsLimit,
                monthlySendsLimit: entitlements.monthlySendsLimit,
            },
        };
    },
    checkout: async ({ req, params, body }) => {
        const authorization = await authorizeOrganization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (authorization.membership.role !== "owner")
            return { status: 403, body: { error: "billing_owner_required" } };
        const ready = await readBillingActionToken(
            req,
            req.res,
            params.organizationId,
        );
        if ("status" in ready) return ready as any;
        const grant: BillingActionGrant = {
            grantId: ready.token,
            actorId: (req as any).userId,
            action: "checkout",
            target: {
                kind: "organization",
                id: authorization.organization.id,
            },
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
        try {
            const result = await createOrganizationCheckout({
                organizationId: authorization.organization.id,
                payerId: (req as any).userId,
                plan: body.plan,
                interval: body.interval,
                catalogRevision: body.catalogRevision,
                grant,
            });
            return { status: 201, body: result };
        } catch (error) {
            if (error instanceof BillingCheckoutError)
                return billingError(error);
            throw error;
        }
    },
    portal: async ({ req, params }) => {
        const authorization = await authorizeOrganization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        if (authorization.membership.role !== "owner")
            return { status: 403, body: { error: "billing_owner_required" } };
        const ready = await readBillingActionToken(
            req,
            req.res,
            params.organizationId,
        );
        if ("status" in ready) return ready as any;
        const grant: BillingActionGrant = {
            grantId: ready.token,
            actorId: (req as any).userId,
            action: "portal",
            target: {
                kind: "organization",
                id: authorization.organization.id,
            },
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
        try {
            const result = await createOrganizationPortal({
                organizationId: authorization.organization.id,
                userId: (req as any).userId,
                grant,
            });
            return { status: 201, body: result };
        } catch (error) {
            if (error instanceof BillingCheckoutError)
                return billingError(error);
            throw error;
        }
    },
    changePlan: async ({
        req,
        params,
        body,
    }: {
        req: any;
        params: any;
        body: any;
    }) => {
        const authorization = await authorizeOrganization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        const ready = await readBillingActionToken(
            req,
            req.res,
            params.organizationId,
        );
        if ("status" in ready) return ready as any;
        const grant: BillingActionGrant = {
            grantId: ready.token,
            actorId: (req as any).userId,
            action: "plan_change",
            target: {
                kind: "organization",
                id: authorization.organization.id,
            },
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
        try {
            const result = await createOrganizationPlanChange({
                organizationId: authorization.organization.id,
                actorId: (req as any).userId,
                plan: body.plan,
                interval: body.interval,
                catalogRevision: body.catalogRevision,
                idempotencyKey: body.idempotencyKey,
                grant,
            });
            return {
                status: result.status === "pending" ? 202 : 200,
                body: result,
            } as any;
        } catch (error) {
            if (error instanceof BillingPlanChangeError)
                return planChangeError(error);
            throw error;
        }
    },
    getPlanChange: async ({ req, params }: { req: any; params: any }) => {
        const authorization = await authorizeOrganization(
            req,
            params.organizationId,
        );
        if (!authorization)
            return { status: 404, body: { error: "organization_not_found" } };
        const result = await getOrganizationPlanChange({
            organizationId: authorization.organization.id,
            changeId: params.changeId,
            userId: (req as any).userId,
        });
        if (!result)
            return {
                status: 404,
                body: { error: "billing_plan_change_not_found" },
            };
        return { status: 200, body: result };
    },
});

// Register middleware before ts-rest endpoints so auth/privacy checks cannot
// be bypassed by a handler added later.
router.use((req, res, next) => {
    if (req.path !== "/billing/catalog") {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
    }
    next();
});
router.use("/billing/catalog", catalogLimiter);
router.use(
    "/billing/action-token",
    rateLimit({
        windowMs: 60_000,
        max: 20,
        standardHeaders: true,
        legacyHeaders: false,
    }),
);
router.use(
    "/organizations/:organizationId/billing/plan-change",
    rateLimit({
        windowMs: 60_000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
    }),
);
router.use("/billing/organization-checkouts", requireAuth);
router.use("/billing/action-token", requireAuth);
router.use("/organizations", requireAuth);
router.use((req, res, next) => {
    if ((req as any).authKind === "session") ensureCsrfCookie(req, res);
    next();
});
// This router is mounted at the app root so it can own `/billing/*` and
// `/organizations/:id/billing/*`. Origin CSRF is therefore path-scoped;
// an unscoped mutation gate would 403 contact/team writes with
// `csrf_origin_invalid` before those routers run.
const billingMutationPaths = [
    "/billing/action-token",
    "/billing/organization-checkouts",
    "/organizations/:organizationId/billing/checkout",
    "/organizations/:organizationId/billing/portal",
    "/organizations/:organizationId/billing/plan-change",
    "/organizations/:organizationId/abandon",
];
router.use(billingMutationPaths, (req, res, next) => {
    if (
        ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
        !billingMutationOrigin(req)
    ) {
        return res.status(403).json({ error: "csrf_origin_invalid" });
    }
    next();
});
createExpressEndpoints(contract.billing, impl, router);

export default router;
