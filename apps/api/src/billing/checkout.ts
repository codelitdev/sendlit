import { BillingWorkflowError } from "@codelitdev/billing/core";
import type { BillingActionGrant } from "@codelitdev/billing/workflows";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { organizations, trialClaims, user } from "../db/schema";
import { createOrganization } from "../organization/queries";
import {
  fingerprintVerifiedEmail,
  getBillingOffer,
  readBillingConfig,
  trialHmacSecrets,
} from "./catalog";
import { requirePublicCatalog } from "./catalog-store";
import { getBillingEngine, getPendingCheckoutResumeGrants } from "./engine";

export class BillingCheckoutError extends Error {
  constructor(
    public readonly code:
      | "billing_catalog_changed"
      | "billing_catalog_unavailable"
      | "billing_provider_unavailable"
      | "billing_owner_required"
      | "recent_authentication_required"
      | "active_subscription_exists"
      | "billing_checkout_pending"
      | "organization_name_already_exists"
      | "pending_organization_exists"
      | "payment_required"
      | "billing_subscription_required"
      | "operation_conflicted",
    public readonly status: 400 | 401 | 402 | 403 | 409 | 503,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "BillingCheckoutError";
  }
}

function mapCheckoutWorkflowError(
  error: unknown,
  details: Record<string, unknown> = {},
): BillingCheckoutError {
  if (error instanceof BillingCheckoutError) return error;
  const code =
    error instanceof BillingWorkflowError ? error.code : "provider_unavailable";
  switch (code) {
    case "catalog_changed":
      return new BillingCheckoutError("billing_catalog_changed", 409, details);
    case "catalog_unavailable":
      return new BillingCheckoutError("billing_catalog_unavailable", 503, details);
    case "active_subscription_exists":
      return new BillingCheckoutError("active_subscription_exists", 409);
    case "checkout_pending":
      return new BillingCheckoutError("billing_checkout_pending", 409);
    case "payer_mismatch":
    case "grant_invalid":
    case "grant_consumed":
      return new BillingCheckoutError("billing_owner_required", 403);
    case "subscription_required":
      return new BillingCheckoutError("payment_required", 402);
    case "operation_conflicted":
      return new BillingCheckoutError("operation_conflicted", 409, {
        retryable: true,
      });
    default:
      return new BillingCheckoutError("billing_provider_unavailable", 503);
  }
}

function errorDetails(config: ReturnType<typeof readBillingConfig>) {
  return {
    catalogRevision: config.catalogRevision,
    currency: config.currency,
    offers: config.offers.map(
      ({ providerProductId: _providerProductId, ...offer }) => offer,
    ),
    checkoutAvailable: config.deploymentMode === "cloud" && config.offers.length === 4,
  };
}

async function reserveTrialInTransaction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    userId: string;
    email: string;
    organizationId: string;
    checkoutAttemptId: string;
    expiresAt: Date;
  },
): Promise<boolean> {
  const secrets = trialHmacSecrets();
  const fingerprints = secrets.map((secret) =>
    fingerprintVerifiedEmail(input.email, secret.secret),
  );
  const [existing] = await tx
    .select()
    .from(trialClaims)
    .where(
      and(
        eq(trialClaims.trialKey, "pro_month"),
        inArray(trialClaims.verifiedEmailFingerprint, fingerprints),
      ),
    )
    .limit(1)
    .for("update");
  const [existingUser] = await tx
    .select()
    .from(trialClaims)
    .where(
      and(eq(trialClaims.userId, input.userId), eq(trialClaims.trialKey, "pro_month")),
    )
    .limit(1)
    .for("update");
  const claimed = existing ?? existingUser;
  if (claimed?.status === "redeemed" || claimed?.status === "reserved") {
    return claimed.checkoutAttemptId === input.checkoutAttemptId;
  }
  if (claimed?.status === "released") {
    const [updated] = await tx
      .update(trialClaims)
      .set({
        organizationId: input.organizationId,
        checkoutAttemptId: input.checkoutAttemptId,
        status: "reserved",
        expiresAt: input.expiresAt,
        verifiedEmailFingerprint: fingerprints[0],
        fingerprintKeyVersion: secrets[0].version,
        updatedAt: new Date(),
      })
      .where(and(eq(trialClaims.id, claimed.id), eq(trialClaims.status, "released")))
      .returning();
    return Boolean(updated);
  }
  const [created] = await tx
    .insert(trialClaims)
    .values({
      userId: input.userId,
      verifiedEmailFingerprint: fingerprints[0],
      fingerprintKeyVersion: secrets[0].version,
      trialKey: "pro_month",
      organizationId: input.organizationId,
      checkoutAttemptId: input.checkoutAttemptId,
      status: "reserved",
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing()
    .returning();
  return Boolean(created);
}

function returnUrl(organizationPublicId: string): string {
  // This is server-owned and intentionally has no client-supplied redirect.
  // Checkout returns to the dashboard origin (not the API origin), where the
  // UI can poll the webhook-backed billing projection.
  const webClient = process.env.WEB_CLIENT || "http://localhost:3000";
  const params = new URLSearchParams({
    tab: "plan",
    billing: "confirming",
    organization: organizationPublicId,
  });
  return `${new URL(webClient).origin}/organizations?${params.toString()}`;
}

export async function createOrganizationCheckout(input: {
  organizationId: string;
  payerId: string;
  plan: "pro" | "business";
  interval: "month" | "year";
  catalogRevision: number;
  grant: BillingActionGrant;
}) {
  let config: ReturnType<typeof readBillingConfig>;
  try {
    config = readBillingConfig();
  } catch {
    throw new BillingCheckoutError("billing_catalog_unavailable", 503);
  }
  if (config.deploymentMode !== "cloud" || !config.catalogRevision) {
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  }
  if (input.catalogRevision !== config.catalogRevision) {
    throw new BillingCheckoutError(
      "billing_catalog_changed",
      409,
      errorDetails(config),
    );
  }
  const offer = getBillingOffer(config, input.plan, input.interval);
  if (!offer) throw new BillingCheckoutError("billing_catalog_unavailable", 503);

  // The engine re-checks the revision and the provider product before it
  // creates the checkout; this only answers SendLit's error shape early.
  try {
    await requirePublicCatalog(config, offer.catalogKey);
  } catch (error) {
    if (error instanceof Error && error.message === "billing_catalog_changed") {
      throw new BillingCheckoutError(
        "billing_catalog_changed",
        409,
        errorDetails(config),
      );
    }
    throw new BillingCheckoutError("billing_catalog_unavailable", 503);
  }

  const [identity] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.id, input.payerId))
    .limit(1);
  if (!identity?.emailVerified) {
    throw new BillingCheckoutError("billing_owner_required", 403, {
      reason: "verified_email_required",
    });
  }

  const [organization] = await db
    .select({ organizationId: organizations.organizationId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization)
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  const [lockedOrganization] = await db
    .select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (
    !lockedOrganization ||
    !["active", "pending_payment"].includes(lockedOrganization.status)
  ) {
    throw new BillingCheckoutError("billing_owner_required", 403);
  }

  // startCheckout releases a lapsed entitlement itself, with audit and the
  // afterProjection hook, before it opens a new checkout.
  const billing = getBillingEngine();

  let trialDays = 0;
  if (offer.trialDays > 0) {
    const secrets = trialHmacSecrets();
    const fingerprints = secrets.map((secret) =>
      fingerprintVerifiedEmail(identity.email, secret.secret),
    );
    const [existing] = await db
      .select({
        status: trialClaims.status,
      })
      .from(trialClaims)
      .where(
        and(
          eq(trialClaims.trialKey, "pro_month"),
          inArray(trialClaims.verifiedEmailFingerprint, fingerprints),
        ),
      )
      .limit(1);
    const [existingUser] = await db
      .select({ status: trialClaims.status })
      .from(trialClaims)
      .where(
        and(eq(trialClaims.userId, identity.id), eq(trialClaims.trialKey, "pro_month")),
      )
      .limit(1);
    const claimed = existing ?? existingUser;
    if (!claimed || claimed.status === "released") {
      trialDays = offer.trialDays;
    }
  }

  try {
    const result = await billing.startCheckout({
      grant: input.grant,
      entity: { kind: "organization", id: input.organizationId },
      payer: {
        id: identity.id,
        email: identity.email,
        name: identity.name || identity.email,
      },
      offerKey: offer.catalogKey,
      catalogRevision: input.catalogRevision,
      returnUrl: returnUrl(organization.organizationId),
      trialDays,
    });
    if (trialDays > 0) {
      await db.transaction((tx) =>
        reserveTrialInTransaction(tx, {
          userId: identity.id,
          email: identity.email,
          organizationId: input.organizationId,
          checkoutAttemptId: result.attempt.id,
          expiresAt: result.attempt.expiresAt,
        }),
      );
    }
    return {
      checkoutUrl: result.checkoutUrl,
      expiresAt: result.attempt.expiresAt.toISOString(),
    };
  } catch (error) {
    throw mapCheckoutWorkflowError(error, errorDetails(config));
  }
}

export async function createPaidOrganizationCheckout(input: {
  payerId: string;
  organizationName: string;
  teamName: string;
  plan: "pro" | "business";
  interval: "month" | "year";
  catalogRevision: number;
  /** The session that presented the consumed `organization_checkout` token. */
  session: { id: string; createdAt: Date };
}) {
  let config: ReturnType<typeof readBillingConfig>;
  try {
    config = readBillingConfig();
  } catch {
    throw new BillingCheckoutError("billing_catalog_unavailable", 503);
  }
  if (config.deploymentMode !== "cloud" || !config.catalogRevision) {
    throw new BillingCheckoutError("billing_provider_unavailable", 503);
  }
  if (input.catalogRevision !== config.catalogRevision) {
    throw new BillingCheckoutError(
      "billing_catalog_changed",
      409,
      errorDetails(config),
    );
  }
  let organization: Awaited<ReturnType<typeof createOrganization>>;
  try {
    organization = await createOrganization(input.payerId, input.organizationName, {
      pendingPayment: true,
      pendingTeamName: input.teamName,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "organization_name_already_exists"
    ) {
      throw new BillingCheckoutError("organization_name_already_exists", 409);
    }
    if (error instanceof Error && error.message === "pending_organization_exists") {
      throw new BillingCheckoutError("pending_organization_exists", 409);
    } else {
      throw error;
    }
  }
  // The route consumed the `organization_checkout` token. The checkout for
  // the new (pending) organization gets its own single-use grant, issued to
  // the same session; pending organizations are exempt from the recent-auth
  // age, so a session that aged during this request still finishes.
  const target = { kind: "organization", id: organization.id };
  const grants = getPendingCheckoutResumeGrants();
  const issued = await grants.issue({
    actorId: input.payerId,
    sessionId: input.session.id,
    sessionCreatedAt: input.session.createdAt,
    action: "checkout",
    target,
  });
  if (!issued.ok) {
    throw new BillingCheckoutError("recent_authentication_required", 401);
  }
  const checkout = await createOrganizationCheckout({
    organizationId: organization.id,
    payerId: input.payerId,
    plan: input.plan,
    interval: input.interval,
    catalogRevision: input.catalogRevision,
    grant: grants.grant({
      token: issued.token,
      actorId: input.payerId,
      sessionId: input.session.id,
      action: "checkout",
      target,
    }),
  });
  return { ...checkout, organizationId: organization.organizationId };
}
