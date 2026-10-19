import { BillingWorkflowError } from "@codelitdev/billing/core";
import type { BillingActionGrant } from "@codelitdev/billing/workflows";
import { type PaidPlan, paidPlans } from "@sendlit/api-contract";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { billingPlanChangeAttempts, organizations } from "../db/schema";
import { getBillingOffer, readBillingConfig } from "./catalog";
import { requirePublicCatalog } from "./catalog-store";
import { getBillingEngine, getBillingSensitiveValues } from "./engine";

type PlanChangeCode =
  | "billing_catalog_changed"
  | "billing_catalog_unavailable"
  | "billing_provider_unavailable"
  | "billing_owner_required"
  | "billing_plan_change_pending"
  | "billing_plan_change_not_supported"
  | "billing_plan_change_same_plan"
  | "billing_subscription_required"
  | "billing_subscription_not_changeable";

export class BillingPlanChangeError extends Error {
  constructor(
    public readonly code: PlanChangeCode,
    public readonly status: 402 | 403 | 409 | 503,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "BillingPlanChangeError";
  }
}

type PlanChangeRow = typeof billingPlanChangeAttempts.$inferSelect;

/** Reads the plan-change attempt row by its public `changeId`. A narrow read:
 * the engine has no public read model for one plan change (upstream gap). */
async function responseFor(row: PlanChangeRow, includePaymentUrl: boolean) {
  let paymentUrl: string | null = null;
  if (includePaymentUrl && row.paymentUrlEncrypted) {
    try {
      paymentUrl = await getBillingSensitiveValues().decrypt(row.paymentUrlEncrypted, {
        operatorActorId: row.actorId,
        reason: "plan_change_payment_url",
      });
    } catch {
      // A corrupted/expired payment link is never surfaced. The
      // provider webhook or a fresh request remains authoritative.
    }
  }
  return {
    changeId: row.changeId,
    status: (row.status === "creating" ? "pending" : row.status) as
      | "pending"
      | "succeeded"
      | "failed"
      | "conflicted",
    targetPlan: row.targetPlan as PaidPlan,
    targetInterval: row.targetInterval as "month" | "year",
    effectiveAt: row.effectiveAt as "immediately" | "next_billing_date",
    paymentUrl,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function planRank(plan: PaidPlan): number {
  return paidPlans.indexOf(plan);
}

function defaultPolicy(
  currentPlan: PaidPlan,
  currentInterval: "month" | "year",
  targetPlan: PaidPlan,
  targetInterval: "month" | "year",
) {
  const upgrade =
    planRank(targetPlan) > planRank(currentPlan) ||
    (targetPlan === currentPlan &&
      currentInterval === "month" &&
      targetInterval === "year");
  return {
    effectiveAt: upgrade ? ("immediately" as const) : ("next_billing_date" as const),
    prorationMode: upgrade
      ? ("prorated_immediately" as const)
      : ("do_not_bill" as const),
  };
}

function mapPlanChangeWorkflowError(
  error: unknown,
  details: Record<string, unknown> = {},
): BillingPlanChangeError {
  if (error instanceof BillingPlanChangeError) return error;
  const code =
    error instanceof BillingWorkflowError ? error.code : "provider_unavailable";
  switch (code) {
    case "catalog_changed":
      return new BillingPlanChangeError("billing_catalog_changed", 409, details);
    case "catalog_unavailable":
      return new BillingPlanChangeError("billing_catalog_unavailable", 503);
    case "subscription_required":
      return new BillingPlanChangeError("billing_subscription_required", 402);
    case "payer_mismatch":
    case "grant_invalid":
    case "grant_consumed":
      return new BillingPlanChangeError("billing_owner_required", 403);
    case "plan_change_pending":
      return new BillingPlanChangeError("billing_plan_change_pending", 409, details);
    case "same_offer":
      return new BillingPlanChangeError("billing_plan_change_same_plan", 409);
    case "plan_change_not_supported":
      return new BillingPlanChangeError("billing_plan_change_not_supported", 409);
    case "subscription_not_changeable":
      return new BillingPlanChangeError("billing_subscription_not_changeable", 409);
    default:
      return new BillingPlanChangeError("billing_provider_unavailable", 503, details);
  }
}

export async function createOrganizationPlanChange(input: {
  organizationId: string;
  actorId: string;
  plan: PaidPlan;
  interval: "month" | "year";
  catalogRevision: number;
  idempotencyKey?: string;
  grant: BillingActionGrant;
}) {
  let config: ReturnType<typeof readBillingConfig>;
  try {
    config = readBillingConfig();
  } catch {
    throw new BillingPlanChangeError("billing_catalog_unavailable", 503);
  }
  if (config.deploymentMode !== "cloud" || !config.catalogRevision) {
    throw new BillingPlanChangeError("billing_provider_unavailable", 503);
  }
  if (input.catalogRevision !== config.catalogRevision) {
    throw new BillingPlanChangeError("billing_catalog_changed", 409, {
      catalogRevision: config.catalogRevision,
      currency: config.currency,
      offers: config.offers.map(
        ({ providerProductId: _providerProductId, ...offer }) => offer,
      ),
      checkoutAvailable: true,
    });
  }
  const offer = getBillingOffer(config, input.plan, input.interval);
  if (!offer) throw new BillingPlanChangeError("billing_catalog_unavailable", 503);

  try {
    await requirePublicCatalog(config, offer.catalogKey);
  } catch (error) {
    if (error instanceof Error && error.message === "billing_catalog_changed") {
      throw new BillingPlanChangeError("billing_catalog_changed", 409, {
        catalogRevision: config.catalogRevision,
        currency: config.currency,
        offers: config.offers.map(
          ({ providerProductId: _providerProductId, ...offer }) => offer,
        ),
        checkoutAvailable: false,
      });
    }
    throw new BillingPlanChangeError("billing_catalog_unavailable", 503);
  }

  const billing = getBillingEngine();
  // Paid state from the engine. It also checks the payer, the provider's
  // plan-change capabilities and the catalog when the change starts; these
  // checks only spare the single-use grant for requests that cannot succeed.
  const commercial = await billing.commercialState(input.organizationId);
  const currentPlan = commercial.activePaidPlan as PaidPlan | null;
  const currentInterval = commercial.billingInterval;
  if (!currentPlan || !paidPlans.includes(currentPlan) || !currentInterval) {
    throw new BillingPlanChangeError("billing_subscription_required", 402);
  }
  const [organization] = await db
    .select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (organization?.status !== "active") {
    throw new BillingPlanChangeError("billing_subscription_not_changeable", 409);
  }
  if (!["trialing", "active"].includes(commercial.subscriptionStatus ?? "")) {
    throw new BillingPlanChangeError("billing_subscription_not_changeable", 409);
  }
  if (currentPlan === input.plan && currentInterval === input.interval) {
    throw new BillingPlanChangeError("billing_plan_change_same_plan", 409);
  }
  const policy = defaultPolicy(
    currentPlan,
    currentInterval,
    input.plan,
    input.interval,
  );
  try {
    const attempt = await billing.startPlanChange({
      grant: input.grant,
      entity: { kind: "organization", id: input.organizationId },
      payer: {
        id: input.actorId,
        email: input.actorId,
        name: input.actorId,
      },
      offerKey: offer.catalogKey,
      catalogRevision: input.catalogRevision,
      effectiveAt: policy.effectiveAt,
      prorationMode: policy.prorationMode,
    });
    const [row] = await db
      .select()
      .from(billingPlanChangeAttempts)
      .where(eq(billingPlanChangeAttempts.changeId, attempt.changeId))
      .limit(1);
    if (!row) throw new BillingPlanChangeError("billing_provider_unavailable", 503);
    return await responseFor(row, true);
  } catch (error) {
    throw mapPlanChangeWorkflowError(error);
  }
}

export async function getOrganizationPlanChange(input: {
  organizationId: string;
  changeId: string;
  userId: string;
}) {
  const [row] = await db
    .select()
    .from(billingPlanChangeAttempts)
    .where(
      and(
        eq(billingPlanChangeAttempts.billableEntityId, input.organizationId),
        eq(billingPlanChangeAttempts.changeId, input.changeId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return await responseFor(row, row.actorId === input.userId);
}
