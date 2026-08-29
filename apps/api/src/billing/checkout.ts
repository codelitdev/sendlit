import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import {
    billingCheckoutAttempts,
    billingPriceEntries,
    billingProviderCustomers,
    billingTrialClaims,
    organizationMembers,
    organizationPlanStates,
    organizationSubscriptions,
    organizations,
    user,
} from "../db/schema";
import { encryptBillingValue, decryptBillingValue } from "./crypto";
import {
    fingerprintVerifiedEmail,
    getBillingOffer,
    readBillingConfig,
    trialHmacSecrets,
} from "./catalog";
import { requireActiveCatalog, verifyCheckoutOffer } from "./catalog-store";
import { getBillingProvider } from "./provider-registry";
import { BillingProviderError, providerErrorSummary } from "./provider";
import { createOrganization } from "../organization/queries";

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
            | "payment_required",
        public readonly status: 400 | 401 | 402 | 403 | 409 | 503,
        public readonly details: Record<string, unknown> = {},
    ) {
        super(code);
        this.name = "BillingCheckoutError";
    }
}

function errorDetails(config: ReturnType<typeof readBillingConfig>) {
    return {
        catalogRevision: config.catalogRevision,
        currency: config.currency,
        offers: config.offers.map(
            ({ providerProductId: _providerProductId, ...offer }) => offer,
        ),
        checkoutAvailable:
            config.deploymentMode === "cloud" && config.offers.length === 4,
    };
}

function expiration(now = new Date()): Date {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
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
        .from(billingTrialClaims)
        .where(
            and(
                eq(billingTrialClaims.trialKey, "pro_month"),
                inArray(
                    billingTrialClaims.verifiedEmailFingerprint,
                    fingerprints,
                ),
            ),
        )
        .limit(1)
        .for("update");
    const [existingUser] = await tx
        .select()
        .from(billingTrialClaims)
        .where(
            and(
                eq(billingTrialClaims.userId, input.userId),
                eq(billingTrialClaims.trialKey, "pro_month"),
            ),
        )
        .limit(1)
        .for("update");
    const claimed = existing ?? existingUser;
    if (claimed?.status === "redeemed" || claimed?.status === "reserved") {
        return claimed.checkoutAttemptId === input.checkoutAttemptId;
    }
    if (claimed?.status === "released") {
        const [updated] = await tx
            .update(billingTrialClaims)
            .set({
                organizationId: input.organizationId,
                checkoutAttemptId: input.checkoutAttemptId,
                status: "reserved",
                expiresAt: input.expiresAt,
                verifiedEmailFingerprint: fingerprints[0],
                fingerprintKeyVersion: secrets[0].version,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(billingTrialClaims.id, claimed.id),
                    eq(billingTrialClaims.status, "released"),
                ),
            )
            .returning();
        return Boolean(updated);
    }
    const [created] = await tx
        .insert(billingTrialClaims)
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
    const webClient = process.env.WEB_CLIENT;
    if (!webClient) throw new Error("WEB_CLIENT_missing");
    const params = new URLSearchParams({
        tab: "plan",
        billing: "confirming",
        organization: organizationPublicId,
    });
    return `${new URL(webClient).origin}/organizations?${params.toString()}`;
}

function cancelUrl(organizationPublicId: string): string {
    const webClient = process.env.WEB_CLIENT;
    if (!webClient) throw new Error("WEB_CLIENT_missing");
    return `${new URL(webClient).origin}/organizations?tab=plan&organization=${encodeURIComponent(organizationPublicId)}`;
}

export async function createOrganizationCheckout(input: {
    organizationId: string;
    payerUserId: string;
    plan: "pro" | "business";
    interval: "month" | "year";
    catalogRevision: number;
    pendingTeamName?: string;
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
    if (!offer)
        throw new BillingCheckoutError("billing_catalog_unavailable", 503);

    const provider = (() => {
        try {
            return getBillingProvider(config.checkoutProvider ?? undefined);
        } catch {
            throw new BillingCheckoutError("billing_provider_unavailable", 503);
        }
    })();
    let catalog;
    try {
        catalog = await requireActiveCatalog(config, provider);
        await verifyCheckoutOffer(config, provider, offer);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "billing_catalog_changed"
        ) {
            throw new BillingCheckoutError(
                "billing_catalog_changed",
                409,
                errorDetails(config),
            );
        }
        throw new BillingCheckoutError("billing_catalog_unavailable", 503);
    }
    const price = catalog.items.find(
        (row) => row.catalogKey === offer.catalogKey,
    )?.price;
    if (!price)
        throw new BillingCheckoutError("billing_catalog_unavailable", 503);

    const [identity] = await db
        .select({
            id: user.id,
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified,
        })
        .from(user)
        .where(eq(user.id, input.payerUserId))
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
    const now = new Date();
    // The durable attempt row owns the provider idempotency key. Repeated
    // requests while an attempt is open return that attempt's URL; a fresh
    // random suffix is generated only after the previous attempt is terminal.
    const attemptKeyPrefix = `checkout:${input.organizationId}:${input.payerUserId}:${offer.catalogKey}:${config.catalogRevision}`;
    const pending = await db.transaction(async (tx) => {
        const [observedPlanState] = await tx
            .select()
            .from(organizationPlanStates)
            .where(
                eq(organizationPlanStates.organizationId, input.organizationId),
            )
            .limit(1);
        let subscription:
            | Pick<
                  typeof organizationSubscriptions.$inferSelect,
                  "id" | "status" | "paidThroughAt" | "cancelAtPeriodEnd"
              >
            | undefined;
        if (observedPlanState?.activeSubscriptionId) {
            [subscription] = await tx
                .select({
                    id: organizationSubscriptions.id,
                    status: organizationSubscriptions.status,
                    paidThroughAt: organizationSubscriptions.paidThroughAt,
                    cancelAtPeriodEnd:
                        organizationSubscriptions.cancelAtPeriodEnd,
                })
                .from(organizationSubscriptions)
                .where(
                    eq(
                        organizationSubscriptions.id,
                        observedPlanState.activeSubscriptionId,
                    ),
                )
                .limit(1)
                .for("update");
        }
        const [existing] = await tx
            .select()
            .from(billingCheckoutAttempts)
            .where(
                and(
                    eq(
                        billingCheckoutAttempts.organizationId,
                        input.organizationId,
                    ),
                    inArray(billingCheckoutAttempts.status, [
                        "creating",
                        "open",
                    ]),
                ),
            )
            .limit(1)
            .for("update");
        const [lockedOrganization] = await tx
            .select({ status: organizations.status })
            .from(organizations)
            .where(eq(organizations.id, input.organizationId))
            .limit(1)
            .for("update");
        if (
            !lockedOrganization ||
            !["active", "pending_payment"].includes(lockedOrganization.status)
        ) {
            throw new BillingCheckoutError("billing_owner_required", 403);
        }
        const [planState] = await tx
            .select()
            .from(organizationPlanStates)
            .where(
                eq(organizationPlanStates.organizationId, input.organizationId),
            )
            .limit(1)
            .for("update");
        if (!planState)
            throw new BillingCheckoutError("billing_provider_unavailable", 503);
        if (
            planState.activeSubscriptionId !==
            (observedPlanState?.activeSubscriptionId ?? null)
        ) {
            throw new BillingCheckoutError("billing_checkout_pending", 409);
        }
        if (planState.activeSubscriptionId) {
            if (
                subscription &&
                (["pending", "trialing", "active", "past_due"].includes(
                    subscription.status,
                ) ||
                    Boolean(
                        subscription.cancelAtPeriodEnd &&
                        subscription.paidThroughAt &&
                        subscription.paidThroughAt > now,
                    ))
            ) {
                throw new BillingCheckoutError(
                    "active_subscription_exists",
                    409,
                );
            }
            // Detach an elapsed or immediately-cancelled source in the same
            // transaction that creates its replacement checkout. Otherwise a
            // payment completed before the hourly expiry sweep would be
            // quarantined as a conflicting live subscription.
            if (subscription) {
                await tx
                    .update(organizationSubscriptions)
                    .set({ isEntitlementSource: false, updatedAt: now })
                    .where(eq(organizationSubscriptions.id, subscription.id));
            }
            await tx
                .update(organizationPlanStates)
                .set({
                    plan: "free",
                    activeSubscriptionId: null,
                    projectionVersion: planState.projectionVersion + 1,
                    updatedAt: now,
                })
                .where(eq(organizationPlanStates.id, planState.id));
        }
        if (existing && existing.expiresAt > now) {
            if (existing.checkoutUrlEncrypted) {
                return { existing };
            }
            throw new BillingCheckoutError("billing_checkout_pending", 409);
        }
        const attemptKey = `${attemptKeyPrefix}:${randomUUID()}`;
        if (existing) {
            await tx
                .update(billingCheckoutAttempts)
                .set({
                    status: "expired",
                    completedAt: now,
                    updatedAt: now,
                    checkoutUrlEncrypted: null,
                })
                .where(eq(billingCheckoutAttempts.id, existing.id));
        }

        let [customer] = await tx
            .select()
            .from(billingProviderCustomers)
            .where(
                and(
                    eq(billingProviderCustomers.provider, provider.provider),
                    eq(billingProviderCustomers.userId, input.payerUserId),
                ),
            )
            .limit(1)
            .for("update");
        if (!customer) {
            [customer] = await tx
                .insert(billingProviderCustomers)
                .values({
                    provider: provider.provider,
                    userId: input.payerUserId,
                    idempotencyKey: `customer:${provider.provider}:${input.payerUserId}`,
                    status: "creating",
                })
                .onConflictDoNothing()
                .returning();
            if (!customer) {
                [customer] = await tx
                    .select()
                    .from(billingProviderCustomers)
                    .where(
                        and(
                            eq(
                                billingProviderCustomers.provider,
                                provider.provider,
                            ),
                            eq(
                                billingProviderCustomers.userId,
                                input.payerUserId,
                            ),
                        ),
                    )
                    .limit(1)
                    .for("update");
            }
        }
        if (!customer)
            throw new BillingCheckoutError("billing_provider_unavailable", 503);
        const [attempt] = await tx
            .insert(billingCheckoutAttempts)
            .values({
                organizationId: input.organizationId,
                payerUserId: input.payerUserId,
                provider: provider.provider,
                catalogRevision: config.catalogRevision!,
                catalogKey: offer.catalogKey,
                requestedPlan: offer.plan,
                requestedInterval: offer.interval,
                pendingTeamName: input.pendingTeamName ?? null,
                billingPriceEntryId: price.id,
                quotedAmountMinor: offer.amountMinor,
                quotedCurrency: offer.currency,
                billingCustomerId: customer.id,
                idempotencyKey: attemptKey,
                status: "creating",
                expiresAt: expiration(now),
            })
            .returning();
        if (!attempt)
            throw new BillingCheckoutError("billing_provider_unavailable", 503);
        let trialEligible = false;
        if (offer.trialDays > 0) {
            trialEligible = await reserveTrialInTransaction(tx, {
                userId: identity.id,
                email: identity.email,
                organizationId: input.organizationId,
                checkoutAttemptId: attempt.id,
                expiresAt: attempt.expiresAt,
            });
        }
        return {
            attempt,
            customer,
            trialDays: trialEligible ? offer.trialDays : 0,
        };
    });

    if ("existing" in pending && pending.existing) {
        try {
            return {
                checkoutUrl: decryptBillingValue(
                    pending.existing.checkoutUrlEncrypted!,
                ),
                expiresAt: pending.existing.expiresAt.toISOString(),
            };
        } catch {
            throw new BillingCheckoutError("billing_checkout_pending", 409);
        }
    }

    const { attempt, customer, trialDays } = pending;
    let customerId = customer.providerCustomerId;
    try {
        if (!customerId) {
            const created = await provider.createCustomer({
                email: identity.email,
                name: identity.name,
                idempotencyKey: customer.idempotencyKey,
            });
            customerId = created.providerCustomerId;
            await db
                .update(billingProviderCustomers)
                .set({
                    providerCustomerId: customerId,
                    status: "active",
                    updatedAt: new Date(),
                    lastError: null,
                })
                .where(eq(billingProviderCustomers.id, customer.id));
        }
        const checkout = await provider.createCheckout({
            productId: offer.providerProductId,
            currency: offer.currency,
            customerId,
            payerEmail: identity.email,
            returnUrl: returnUrl(organization.organizationId),
            cancelUrl: cancelUrl(organization.organizationId),
            attemptId: attempt.attemptId,
            catalogKey: offer.catalogKey,
            trialDays,
            idempotencyKey: attempt.idempotencyKey,
        });
        await db
            .update(billingCheckoutAttempts)
            .set({
                providerCheckoutSessionId: checkout.providerCheckoutSessionId,
                checkoutUrlEncrypted: encryptBillingValue(checkout.checkoutUrl),
                status: "open",
                updatedAt: new Date(),
            })
            .where(eq(billingCheckoutAttempts.id, attempt.id));
        return {
            checkoutUrl: checkout.checkoutUrl,
            expiresAt: attempt.expiresAt.toISOString(),
        };
    } catch (error) {
        // Only an explicitly definitive provider rejection can safely abandon
        // the attempt. Unknown/network errors may have reached the provider,
        // so leave the row creating for reconciliation with the same key.
        const ambiguous =
            !(error instanceof BillingProviderError) ||
            error.code === "unavailable" ||
            error.code === "rate_limited";
        await db
            .update(billingCheckoutAttempts)
            .set({
                status: ambiguous ? "creating" : "abandoned",
                completedAt: ambiguous ? null : new Date(),
                lastError: providerErrorSummary(error),
                updatedAt: new Date(),
            })
            .where(eq(billingCheckoutAttempts.id, attempt.id));
        await db
            .update(billingProviderCustomers)
            .set({
                status: customerId ? "active" : "creating",
                lastError: providerErrorSummary(error),
                updatedAt: new Date(),
            })
            .where(eq(billingProviderCustomers.id, customer.id));
        if (!ambiguous) {
            await db
                .update(billingTrialClaims)
                .set({ status: "released", updatedAt: new Date() })
                .where(
                    and(
                        eq(billingTrialClaims.checkoutAttemptId, attempt.id),
                        eq(billingTrialClaims.status, "reserved"),
                    ),
                );
        }
        if (error instanceof BillingCheckoutError) throw error;
        throw new BillingCheckoutError("billing_provider_unavailable", 503);
    }
}

/** Resume a durable `creating` checkout after an API/provider timeout. The
 * original attempt and provider idempotency key are reused; no new checkout
 * row is created and an ambiguous provider response cannot create a second
 * subscription. */
export async function resumeOrganizationCheckoutAttempt(
    attemptId: string,
    now = new Date(),
): Promise<boolean> {
    const [row] = await db
        .select({
            attempt: billingCheckoutAttempts,
            customer: billingProviderCustomers,
            organizationPublicId: organizations.organizationId,
            email: user.email,
            name: user.name,
            price: billingPriceEntries,
        })
        .from(billingCheckoutAttempts)
        .innerJoin(
            billingProviderCustomers,
            eq(
                billingProviderCustomers.id,
                billingCheckoutAttempts.billingCustomerId,
            ),
        )
        .innerJoin(
            organizations,
            eq(organizations.id, billingCheckoutAttempts.organizationId),
        )
        .innerJoin(user, eq(user.id, billingCheckoutAttempts.payerUserId))
        .innerJoin(
            billingPriceEntries,
            eq(
                billingPriceEntries.id,
                billingCheckoutAttempts.billingPriceEntryId,
            ),
        )
        .where(eq(billingCheckoutAttempts.id, attemptId))
        .limit(1);
    if (
        !row ||
        row.attempt.status !== "creating" ||
        row.attempt.expiresAt <= now
    )
        return false;
    const provider = getBillingProvider(row.attempt.provider);
    let customerId = row.customer.providerCustomerId;
    try {
        if (!customerId) {
            const created = await provider.createCustomer({
                email: row.email,
                name: row.name,
                idempotencyKey: row.customer.idempotencyKey,
            });
            customerId = created.providerCustomerId;
            await db
                .update(billingProviderCustomers)
                .set({
                    providerCustomerId: customerId,
                    status: "active",
                    updatedAt: now,
                    lastError: null,
                })
                .where(eq(billingProviderCustomers.id, row.customer.id));
        }
        const config = readBillingConfig();
        const configuredOffer = getBillingOffer(
            config,
            row.attempt.requestedPlan as "pro" | "business",
            row.attempt.requestedInterval as "month" | "year",
        );
        let trialDays = 0;
        if (configuredOffer?.trialDays) {
            const eligible = await db.transaction((tx) =>
                reserveTrialInTransaction(tx, {
                    userId: row.attempt.payerUserId,
                    email: row.email,
                    organizationId: row.attempt.organizationId,
                    checkoutAttemptId: row.attempt.id,
                    expiresAt: row.attempt.expiresAt,
                }),
            );
            if (eligible) trialDays = configuredOffer.trialDays;
        }
        const checkout = await provider.createCheckout({
            productId: row.price.providerProductId,
            currency: row.price.currency,
            customerId,
            payerEmail: row.email,
            returnUrl: returnUrl(row.organizationPublicId),
            cancelUrl: cancelUrl(row.organizationPublicId),
            attemptId: row.attempt.attemptId,
            catalogKey: row.attempt.catalogKey,
            trialDays,
            idempotencyKey: row.attempt.idempotencyKey,
        });
        await db
            .update(billingCheckoutAttempts)
            .set({
                providerCheckoutSessionId: checkout.providerCheckoutSessionId,
                checkoutUrlEncrypted: encryptBillingValue(checkout.checkoutUrl),
                status: "open",
                updatedAt: now,
                lastError: null,
            })
            .where(eq(billingCheckoutAttempts.id, row.attempt.id));
        return true;
    } catch (error) {
        await db
            .update(billingCheckoutAttempts)
            .set({ lastError: providerErrorSummary(error), updatedAt: now })
            .where(eq(billingCheckoutAttempts.id, row.attempt.id));
        throw error;
    }
}

export async function createPaidOrganizationCheckout(input: {
    payerUserId: string;
    organizationName: string;
    teamName: string;
    plan: "pro" | "business";
    interval: "month" | "year";
    catalogRevision: number;
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
    let organization;
    try {
        organization = await createOrganization(
            input.payerUserId,
            input.organizationName,
            {
                pendingPayment: true,
            },
        );
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "organization_name_already_exists"
        ) {
            throw new BillingCheckoutError(
                "organization_name_already_exists",
                409,
            );
        }
        if (
            error instanceof Error &&
            error.message === "pending_organization_exists"
        ) {
            const [existing] = await db
                .select({ organization: organizations })
                .from(organizations)
                .innerJoin(
                    organizationMembers,
                    eq(organizationMembers.organizationId, organizations.id),
                )
                .where(
                    and(
                        eq(organizationMembers.userId, input.payerUserId),
                        eq(organizationMembers.role, "owner"),
                        eq(organizations.status, "pending_payment"),
                    ),
                )
                .limit(1);
            if (!existing?.organization) throw error;
            organization = existing.organization;
        } else {
            throw error;
        }
    }
    try {
        const checkout = await createOrganizationCheckout({
            organizationId: organization.id,
            payerUserId: input.payerUserId,
            plan: input.plan,
            interval: input.interval,
            catalogRevision: input.catalogRevision,
            pendingTeamName: input.teamName,
        });
        return { ...checkout, organizationId: organization.organizationId };
    } catch (error) {
        throw error;
    }
}
