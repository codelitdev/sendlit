import { contract, type PaidPlan, paidPlans } from "@sendlit/api-contract";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../auth/middleware";
import { db } from "../db/client";
import {
  billingPlanChangeAttempts,
  billingPlanStates,
  billingSubscriptions,
} from "../db/schema";
import {
  getOrganizationByPublicId,
  getOrganizationMembership,
} from "../organization/queries";
import {
  BillingCancellationError,
  cancelOrganizationSubscription,
  resumeOrganizationSubscription,
} from "./cancellation";
import { type BillingOffer, readBillingConfig } from "./catalog";
import { getPublicCatalog } from "./catalog-store";
import {
  BillingCheckoutError,
  createOrganizationCheckout,
  createPaidOrganizationCheckout,
} from "./checkout";
import { getOrganizationEntitlements } from "./entitlements";
import {
  BillingPlanChangeError,
  createOrganizationPlanChange,
  getOrganizationPlanChange,
} from "./plan-change";
import { planPolicies } from "./policies";
import { createOrganizationPortal } from "./portal";
import {
  type BillingAction,
  billingGrantFromToken,
  billingMutationOrigin,
  consumeNewOrganizationCheckoutToken,
  ensureCsrfCookie,
  issueBillingActionToken,
  readBillingActionToken,
} from "./security";
import { usageForOrganization } from "./usage";

const router = Router();
const s = initServer();
let publicCatalogCache: {
  revision: number;
  expiresAt: number;
  offers: ReturnType<typeof readBillingConfig>["offers"];
  checkoutAvailable: boolean;
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

function cancellationError(error: unknown) {
  if (error instanceof BillingCheckoutError) return billingError(error);
  if (error instanceof BillingCancellationError) {
    return { status: error.status, body: error.body } as any;
  }
  throw error;
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
  const membership = await getOrganizationMembership(organization.id, req.userId);
  return membership ? { organization, membership } : null;
}

function organizationGrant(
  req: any,
  ready: { token: string; sessionId: string },
  action: "checkout" | "portal" | "plan_change" | "cancellation",
  authorization: { organization: { id: string } },
) {
  return billingGrantFromToken(ready, req.userId, action, {
    kind: "organization",
    id: authorization.organization.id,
  });
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
    const consumed = await consumeNewOrganizationCheckoutToken(req, req.res);
    if ("status" in consumed) return consumed as any;
    try {
      const result = await createPaidOrganizationCheckout({
        payerId: req.userId,
        session: { id: consumed.sessionId, createdAt: consumed.sessionCreatedAt },
        organizationName: body.organizationName,
        teamName: body.teamName,
        plan: body.plan,
        interval: body.interval,
        catalogRevision: body.catalogRevision,
      });
      return { status: 201, body: result };
    } catch (error) {
      if (error instanceof BillingCheckoutError) return billingError(error);
      throw error;
    }
  },
  catalog: async ({ req }: { req: any }) => {
    try {
      const config = readBillingConfig();
      let offers = config.offers;
      let activeRevision = config.catalogRevision;
      let checkoutAvailable = false;
      if (config.deploymentMode === "cloud") {
        const cached =
          publicCatalogCache && publicCatalogCache.expiresAt > Date.now()
            ? publicCatalogCache
            : null;
        if (cached) {
          offers = cached.offers;
          activeRevision = cached.revision;
          checkoutAvailable = cached.checkoutAvailable;
        } else {
          const active = await getPublicCatalog(config);
          offers = active.offers.map((offer) => {
            const configured = config.offers.find(
              (row) => row.catalogKey === offer.key,
            );
            return {
              catalogKey: offer.key as BillingOffer["catalogKey"],
              catalogRevision: active.revision,
              plan: offer.plan as PaidPlan,
              interval: offer.interval as "month" | "year",
              currency: offer.currency,
              amountMinor: offer.amountMinor,
              provider: configured?.provider ?? config.checkoutProvider ?? "",
              providerProductId: configured?.providerProductId ?? "",
              trialDays: configured?.trialDays ?? offer.displayTrialDays,
            };
          });
          activeRevision = active.revision;
          checkoutAvailable = active.checkoutAvailable;
          publicCatalogCache = {
            revision: active.revision,
            expiresAt: Date.now() + 5 * 60 * 1000,
            offers,
            checkoutAvailable,
          };
        }
      }
      const etag = `W/"billing-${activeRevision ?? "oss"}"`;
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
            ({ catalogKey, plan, interval, currency, amountMinor, trialDays }) => ({
              catalogKey,
              plan,
              interval,
              currency,
              amountMinor,
              trialDays,
            }),
          ),
          plans: paidPlans.map((plan) => {
            const policy = planPolicies[plan];
            return {
              plan,
              teamsLimit: policy.teamsLimit,
              monthlySendsLimit: policy.monthlySendsLimit,
              marketingBranding: policy.marketingBranding,
              sharedOrganizationMailbox: policy.sharedOrganizationMailbox,
              provisioning: policy.provisioning,
              organizationApiKeys: policy.organizationApiKeys,
            };
          }),
          checkoutAvailable,
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
    const authorization = await authorizeOrganization(req, params.organizationId);
    if (!authorization) {
      return { status: 404, body: { error: "organization_not_found" } };
    }
    const organizationId = authorization.organization.id;
    // Paid state (plan, status, dates) comes from the engine through
    // getOrganizationEntitlements. Two narrow reads remain because
    // commercialState has no read model for them (upstream gaps): the
    // billing manager (payer) and the details of a pending plan change.
    const [manager] = await db
      .select({ payerId: billingSubscriptions.payerId })
      .from(billingPlanStates)
      .innerJoin(
        billingSubscriptions,
        eq(billingSubscriptions.id, billingPlanStates.activeSubscriptionId),
      )
      .where(eq(billingPlanStates.billableEntityId, organizationId))
      .limit(1);
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
          eq(billingPlanChangeAttempts.billableEntityId, organizationId),
          eq(billingPlanChangeAttempts.status, "pending"),
        ),
      )
      .limit(1);
    const entitlements = await getOrganizationEntitlements(
      authorization.organization.id,
    );
    const usage = await usageForOrganization(authorization.organization.id);
    const billingManager = manager?.payerId ?? null;
    return {
      status: 200,
      body: {
        plan: entitlements.plan,
        billingInterval: entitlements.interval,
        paymentStatus: entitlements.paymentStatus,
        trialEndsAt: entitlements.trialEndsAt?.toISOString() ?? null,
        currentPeriodEndsAt: entitlements.currentPeriodEndsAt?.toISOString() ?? null,
        paidThroughAt: entitlements.paidThroughAt?.toISOString() ?? null,
        cancelAtPeriodEnd: entitlements.cancelAtPeriodEnd,
        graceEndsAt: entitlements.graceEndsAt?.toISOString() ?? null,
        canManageBilling:
          authorization.membership.role === "owner" &&
          (!billingManager || billingManager === (req as any).userId),
        entitlements: {
          teamsLimit: entitlements.teamsLimit,
          subscribedContactsLimit: entitlements.subscribedContactsLimit,
          monthlySendsLimit: entitlements.monthlySendsLimit,
          sharedOrganizationMailbox: entitlements.sharedOrganizationMailbox,
          provisioning: entitlements.provisioning,
          organizationApiKeys: entitlements.organizationApiKeys,
          marketingBranding: entitlements.marketingBranding,
        },
        usage: {
          ...usage,
          plan: entitlements.plan,
          paymentStatus: entitlements.paymentStatus,
          teamsLimit: entitlements.teamsLimit,
          subscribedContactsLimit: entitlements.subscribedContactsLimit,
          monthlySendsLimit: entitlements.monthlySendsLimit,
        },
        pendingPlanChange: pendingPlanChange
          ? {
              changeId: pendingPlanChange.changeId,
              targetPlan: pendingPlanChange.targetPlan as PaidPlan,
              targetInterval: pendingPlanChange.targetInterval as "month" | "year",
              effectiveAt: pendingPlanChange.effectiveAt as
                | "immediately"
                | "next_billing_date",
            }
          : null,
      },
    };
  },
  organizationPlanUsage: async ({ req, params }) => {
    const authorization = await authorizeOrganization(req, params.organizationId);
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
    const authorization = await authorizeOrganization(req, params.organizationId);
    if (!authorization)
      return { status: 404, body: { error: "organization_not_found" } };
    if (authorization.membership.role !== "owner")
      return { status: 403, body: { error: "billing_owner_required" } };
    const ready = await readBillingActionToken(req, req.res, params.organizationId);
    if ("status" in ready) return ready as any;
    const grant = organizationGrant(req, ready, "checkout", authorization);
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
      if (error instanceof BillingCheckoutError) return billingError(error);
      throw error;
    }
  },
  portal: async ({ req, params }) => {
    const authorization = await authorizeOrganization(req, params.organizationId);
    if (!authorization)
      return { status: 404, body: { error: "organization_not_found" } };
    if (authorization.membership.role !== "owner")
      return { status: 403, body: { error: "billing_owner_required" } };
    const ready = await readBillingActionToken(req, req.res, params.organizationId);
    if ("status" in ready) return ready as any;
    const grant = organizationGrant(req, ready, "portal", authorization);
    try {
      const result = await createOrganizationPortal({
        organizationId: authorization.organization.id,
        userId: (req as any).userId,
        grant,
      });
      return { status: 201, body: result };
    } catch (error) {
      if (error instanceof BillingCheckoutError) return billingError(error);
      throw error;
    }
  },
  cancel: async ({ req, params }: { req: any; params: any }) => {
    const authorization = await authorizeOrganization(req, params.organizationId);
    if (!authorization)
      return { status: 404, body: { error: "organization_not_found" } };
    if (authorization.membership.role !== "owner")
      return { status: 403, body: { error: "billing_owner_required" } };
    const ready = await readBillingActionToken(req, req.res, params.organizationId);
    if ("status" in ready) return ready as any;
    try {
      const result = await cancelOrganizationSubscription({
        organizationId: authorization.organization.id,
        userId: req.userId,
        grant: organizationGrant(req, ready, "cancellation", authorization),
      });
      return { status: 200, body: result };
    } catch (error) {
      return cancellationError(error);
    }
  },
  resume: async ({ req, params }: { req: any; params: any }) => {
    const authorization = await authorizeOrganization(req, params.organizationId);
    if (!authorization)
      return { status: 404, body: { error: "organization_not_found" } };
    if (authorization.membership.role !== "owner")
      return { status: 403, body: { error: "billing_owner_required" } };
    const ready = await readBillingActionToken(req, req.res, params.organizationId);
    if ("status" in ready) return ready as any;
    try {
      const result = await resumeOrganizationSubscription({
        organizationId: authorization.organization.id,
        userId: req.userId,
        grant: organizationGrant(req, ready, "cancellation", authorization),
      });
      return { status: 200, body: result };
    } catch (error) {
      return cancellationError(error);
    }
  },
  changePlan: async ({ req, params, body }: { req: any; params: any; body: any }) => {
    const authorization = await authorizeOrganization(req, params.organizationId);
    if (!authorization)
      return { status: 404, body: { error: "organization_not_found" } };
    const ready = await readBillingActionToken(req, req.res, params.organizationId);
    if ("status" in ready) return ready as any;
    const grant = organizationGrant(req, ready, "plan_change", authorization);
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
      if (error instanceof BillingPlanChangeError) return planChangeError(error);
      throw error;
    }
  },
  getPlanChange: async ({ req, params }: { req: any; params: any }) => {
    const authorization = await authorizeOrganization(req, params.organizationId);
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
for (const path of [
  "/organizations/:organizationId/billing/plan-change",
  "/organizations/:organizationId/billing/cancel",
  "/organizations/:organizationId/billing/resume",
]) {
  router.use(
    path,
    rateLimit({
      windowMs: 60_000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
}
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
  "/organizations/:organizationId/billing/cancel",
  "/organizations/:organizationId/billing/resume",
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
