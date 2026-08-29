import {
    and,
    eq,
    gt,
    isNotNull,
    isNull,
    lte,
    lt,
    or,
    inArray,
    sql,
} from "drizzle-orm";
import { db } from "../db/client";
import {
    billingCheckoutAttempts,
    billingPlanChangeAttempts,
    billingPriceEntries,
    billingWebhookEvents,
    organizationSubscriptions,
    organizations,
    planSendReservations,
    sendingDomains,
} from "../db/schema";
import { readBillingConfig } from "./catalog";
import { getBillingProvider } from "./provider-registry";
import {
    recordRequestedCatalogRevision,
    verifyCatalogAgainstProvider,
} from "./catalog-store";
import { recordBillingMetric } from "./metrics";
import { providerErrorSummary } from "./provider";
import {
    applyCanonicalBillingEvent,
    claimBillingWebhookEvent,
    expireCancelledSubscriptionEntitlements,
    processBillingWebhookInboxEvent,
} from "./webhooks/processor";
import { resumeOrganizationCheckoutAttempt } from "./checkout";
import { settleExpiredSendReservation } from "./entitlements";
import { evaluateAllTeamReputations } from "./reputation";
import { verifySendingDomain } from "./domains";
import { encryptBillingValue } from "./crypto";
import { evaluateBillingSloAlerts, recordBillingHourlySuccess } from "./alerts";
import logger from "../services/log";

let hourlyTimer: NodeJS.Timeout | undefined;
let inboxTimer: NodeJS.Timeout | undefined;
let hourlyRunning = false;
let inboxRunning = false;

export async function processBillingInboxOnce(now = new Date()): Promise<void> {
    const inbox = await db
        .select({ id: billingWebhookEvents.id })
        .from(billingWebhookEvents)
        .where(
            or(
                eq(billingWebhookEvents.status, "pending"),
                and(
                    eq(billingWebhookEvents.status, "failed"),
                    lte(billingWebhookEvents.availableAt, now),
                ),
                and(
                    eq(billingWebhookEvents.status, "processing"),
                    lt(billingWebhookEvents.leaseExpiresAt, now),
                ),
            ),
        )
        .limit(100);
    for (const event of inbox) {
        if (await claimBillingWebhookEvent(event.id, now)) {
            await processBillingWebhookInboxEvent(event.id).catch((error) => {
                logger.error(
                    {
                        billing_webhook_event_id: event.id,
                        error: providerErrorSummary(error),
                    },
                    "billing webhook inbox event failed",
                );
            });
        }
    }
}

export async function settleExpiredSendReservationsOnce(
    now = new Date(),
): Promise<void> {
    const expiredReservations = await db
        .select({ outboundMessageId: planSendReservations.outboundMessageId })
        .from(planSendReservations)
        .where(
            and(
                eq(planSendReservations.state, "reserved"),
                lte(planSendReservations.expiresAt, now),
            ),
        )
        .limit(500);
    for (const reservation of expiredReservations) {
        await settleExpiredSendReservation(
            reservation.outboundMessageId,
            now,
        ).catch((error) => {
            logger.error(
                {
                    outbound_message_id: reservation.outboundMessageId,
                    error: providerErrorSummary(error),
                },
                "expired send reservation settlement failed",
            );
        });
    }
}

export async function reconcileBillingOnce(now = new Date()): Promise<void> {
    let config;
    try {
        config = readBillingConfig();
    } catch {
        return;
    }
    if (config.deploymentMode !== "cloud") return;
    try {
        await recordRequestedCatalogRevision(config);
        const provider = getBillingProvider(
            config.checkoutProvider ?? undefined,
        );
        await verifyCatalogAgainstProvider(config, provider);
    } catch (error) {
        logger.error(
            { error: providerErrorSummary(error) },
            "billing catalog verification failed",
        );
        recordBillingMetric("billing.catalog.verify_failed", {});
    }
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    const attempts = await db
        .update(billingCheckoutAttempts)
        .set({
            status: "expired",
            completedAt: now,
            checkoutUrlEncrypted: null,
            updatedAt: now,
        })
        .where(
            and(
                inArray(billingCheckoutAttempts.status, ["creating", "open"]),
                lt(billingCheckoutAttempts.expiresAt, now),
            ),
        )
        .returning({ id: billingCheckoutAttempts.id });
    if (attempts.length)
        logger.info(
            { billing_checkout_expired: attempts.length },
            "billing checkout attempts expired",
        );
    const creatingAttempts = await db
        .select({ id: billingCheckoutAttempts.id })
        .from(billingCheckoutAttempts)
        .where(
            and(
                eq(billingCheckoutAttempts.status, "creating"),
                lt(
                    billingCheckoutAttempts.updatedAt,
                    new Date(now.getTime() - 60 * 1000),
                ),
                gt(billingCheckoutAttempts.expiresAt, now),
            ),
        )
        .limit(100);
    for (const attempt of creatingAttempts) {
        const [claimed] = await db
            .update(billingCheckoutAttempts)
            .set({ updatedAt: now })
            .where(
                and(
                    eq(billingCheckoutAttempts.id, attempt.id),
                    eq(billingCheckoutAttempts.status, "creating"),
                    lt(
                        billingCheckoutAttempts.updatedAt,
                        new Date(now.getTime() - 60 * 1000),
                    ),
                    gt(billingCheckoutAttempts.expiresAt, now),
                ),
            )
            .returning({ id: billingCheckoutAttempts.id });
        if (claimed) {
            await resumeOrganizationCheckoutAttempt(claimed.id, now).catch(
                (error) => {
                    logger.warn(
                        {
                            billing_checkout_attempt: claimed.id,
                            error: providerErrorSummary(error),
                        },
                        "billing checkout resume failed",
                    );
                },
            );
        }
    }
    // A reserved trial is never released merely because its local checkout
    // window elapsed: a provider may have created a subscription while the
    // response was lost. Release is an explicit/operator-reconciled action.
    await expireCancelledSubscriptionEntitlements(now);
    // Paid-organization creation is intentionally two-phase: a pending org is
    // retained while checkout can still arrive, then tombstoned after its
    // attempts have expired/abandoned. Data and correlation rows are never
    // deleted, so late provider events can only be quarantined.
    const pendingOrganizations = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(
            and(
                eq(organizations.status, "pending_payment"),
                lt(
                    organizations.createdAt,
                    new Date(now.getTime() - 24 * 60 * 60 * 1000),
                ),
            ),
        )
        .limit(100);
    for (const organization of pendingOrganizations) {
        const [attempt] = await db
            .select({ id: billingCheckoutAttempts.id })
            .from(billingCheckoutAttempts)
            .where(
                and(
                    eq(billingCheckoutAttempts.organizationId, organization.id),
                    inArray(billingCheckoutAttempts.status, [
                        "creating",
                        "open",
                    ]),
                ),
            )
            .limit(1);
        if (!attempt) {
            await db
                .update(organizations)
                .set({ status: "abandoned", updatedAt: now })
                .where(
                    and(
                        eq(organizations.id, organization.id),
                        eq(organizations.status, "pending_payment"),
                    ),
                );
        }
    }
    const dueDomains = await db
        .select({
            organizationId: sendingDomains.organizationId,
            domainId: sendingDomains.domainId,
        })
        .from(sendingDomains)
        .where(
            and(
                inArray(sendingDomains.status, [
                    "pending",
                    "verified",
                    "failed",
                ]),
                lt(sendingDomains.nextCheckAt, now),
            ),
        )
        .limit(100);
    for (const domain of dueDomains) {
        // Claim the check briefly so multiple API instances do not count the
        // same failed DNS lookup several times in one sweep.
        const [claimed] = await db
            .update(sendingDomains)
            .set({
                nextCheckAt: new Date(now.getTime() + 60 * 60 * 1000),
                updatedAt: now,
            })
            .where(
                and(
                    eq(sendingDomains.domainId, domain.domainId),
                    lt(sendingDomains.nextCheckAt, now),
                ),
            )
            .returning({
                organizationId: sendingDomains.organizationId,
                domainId: sendingDomains.domainId,
            });
        if (claimed) {
            await verifySendingDomain(
                claimed.organizationId,
                claimed.domainId,
            ).catch(() => {
                logger.warn(
                    { sending_domain_check: claimed.domainId },
                    "sending domain verification failed",
                );
            });
        }
    }
    await settleExpiredSendReservationsOnce(now);
    await processBillingInboxOnce(now);
    const subscriptions = await db
        .select()
        .from(organizationSubscriptions)
        .where(
            and(
                inArray(organizationSubscriptions.status, [
                    "pending",
                    "trialing",
                    "active",
                    "past_due",
                    "cancelled",
                ]),
                or(
                    isNull(organizationSubscriptions.lastReconciledAt),
                    lt(organizationSubscriptions.lastReconciledAt, cutoff),
                ),
            ),
        )
        .limit(100);
    for (const candidate of subscriptions) {
        const [subscription] = await db
            .select()
            .from(organizationSubscriptions)
            .where(eq(organizationSubscriptions.id, candidate.id))
            .limit(1)
            .for("update", { skipLocked: true });
        if (!subscription) continue;
        try {
            const provider = getBillingProvider(subscription.provider);
            const snapshot = await provider.retrieveSubscription(
                subscription.providerSubscriptionId,
            );
            await applyCanonicalBillingEvent({
                provider: subscription.provider,
                providerEventId: `reconcile:${subscription.id}:${snapshot.occurredAt.toISOString()}`,
                eventType: "subscription.reconciled",
                occurredAt: snapshot.occurredAt,
                subscriptionId: snapshot.providerSubscriptionId,
                snapshot,
                rawPayload: null,
            });
            await db
                .update(organizationSubscriptions)
                .set({ lastReconciledAt: now, updatedAt: now })
                .where(eq(organizationSubscriptions.id, subscription.id));
        } catch (error) {
            // Provider outages and quarantined records are isolated; the next
            // hourly pass retries them without affecting other organizations.
            logger.warn(
                {
                    billing_reconciliation_subscription: subscription.id,
                    error: providerErrorSummary(error),
                },
                "billing subscription reconciliation failed",
            );
        }
    }
    // Retry ambiguous plan-change mutations with the same provider
    // idempotency key. A provider that already applied the request returns the
    // original result; a scheduled change may safely remain pending until its
    // next-billing snapshot arrives.
    const planChanges = await db
        .select({
            attempt: billingPlanChangeAttempts,
            subscription: organizationSubscriptions,
            price: billingPriceEntries,
        })
        .from(billingPlanChangeAttempts)
        .innerJoin(
            organizationSubscriptions,
            eq(
                organizationSubscriptions.id,
                billingPlanChangeAttempts.subscriptionId,
            ),
        )
        .innerJoin(
            billingPriceEntries,
            eq(
                billingPriceEntries.id,
                billingPlanChangeAttempts.targetBillingPriceEntryId,
            ),
        )
        .where(
            and(
                or(
                    eq(billingPlanChangeAttempts.status, "creating"),
                    and(
                        eq(billingPlanChangeAttempts.status, "pending"),
                        isNotNull(billingPlanChangeAttempts.lastError),
                    ),
                ),
                or(
                    isNull(billingPlanChangeAttempts.updatedAt),
                    lt(billingPlanChangeAttempts.updatedAt, cutoff),
                ),
            ),
        )
        .limit(100);
    for (const { attempt, subscription, price } of planChanges) {
        const [claimed] = await db
            .update(billingPlanChangeAttempts)
            .set({ updatedAt: now })
            .where(
                and(
                    eq(billingPlanChangeAttempts.id, attempt.id),
                    or(
                        eq(billingPlanChangeAttempts.status, "creating"),
                        and(
                            eq(billingPlanChangeAttempts.status, "pending"),
                            isNotNull(billingPlanChangeAttempts.lastError),
                        ),
                    ),
                    or(
                        isNull(billingPlanChangeAttempts.updatedAt),
                        lt(billingPlanChangeAttempts.updatedAt, cutoff),
                    ),
                ),
            )
            .returning({ id: billingPlanChangeAttempts.id });
        if (!claimed) continue;
        try {
            const provider = getBillingProvider(attempt.provider);
            const result = await provider.changeSubscriptionPlan({
                providerSubscriptionId: subscription.providerSubscriptionId,
                targetProviderProductId: price.providerProductId,
                effectiveAt: attempt.effectiveAt as
                    "immediately" | "next_billing_date",
                prorationMode: attempt.prorationMode as
                    "prorated_immediately" | "do_not_bill",
                idempotencyKey: attempt.idempotencyKey,
            });
            await db
                .update(billingPlanChangeAttempts)
                .set({
                    providerPaymentId: result.providerPaymentId,
                    paymentUrlEncrypted: result.paymentUrl
                        ? encryptBillingValue(result.paymentUrl)
                        : attempt.paymentUrlEncrypted,
                    lastError: null,
                    updatedAt: now,
                })
                .where(eq(billingPlanChangeAttempts.id, attempt.id));
        } catch (error) {
            await db
                .update(billingPlanChangeAttempts)
                .set({
                    lastError: providerErrorSummary(error),
                    updatedAt: now,
                })
                .where(eq(billingPlanChangeAttempts.id, attempt.id));
        }
    }
    // Webhook bodies contain provider metadata and are retained only for the
    // documented replay window. The durable event status and subscription
    // projection remain available for audit after the encrypted payload is
    // purged.
    await db
        .update(billingWebhookEvents)
        .set({ payloadEncrypted: null })
        .where(
            and(
                inArray(billingWebhookEvents.status, [
                    "processed",
                    "ignored",
                    "quarantined",
                ]),
                lt(
                    sql`coalesce(${billingWebhookEvents.processedAt}, ${billingWebhookEvents.receivedAt})`,
                    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
                ),
            ),
        );
    await evaluateAllTeamReputations(now);
    recordBillingHourlySuccess(now);
    await evaluateBillingSloAlerts(now).catch((error) => {
        logger.error(
            { error: providerErrorSummary(error) },
            "billing SLO evaluation failed",
        );
    });
}

async function runHourlyBillingSweep(failureMessage: string): Promise<void> {
    if (hourlyRunning) return;
    hourlyRunning = true;
    try {
        await reconcileBillingOnce();
    } catch (error) {
        logger.error({ error: providerErrorSummary(error) }, failureMessage);
    } finally {
        hourlyRunning = false;
    }
}

async function runBillingInboxSweep(): Promise<void> {
    if (inboxRunning) return;
    inboxRunning = true;
    try {
        const now = new Date();
        const results = await Promise.allSettled([
            processBillingInboxOnce(now),
            settleExpiredSendReservationsOnce(now),
        ]);
        for (const result of results) {
            if (result.status === "rejected") {
                logger.error(
                    { error: providerErrorSummary(result.reason) },
                    "billing maintenance sweep failed",
                );
            }
        }
    } finally {
        inboxRunning = false;
    }
}

export function startBillingReconciliation(): void {
    if (hourlyTimer || inboxTimer) return;
    void runHourlyBillingSweep("initial billing reconciliation failed");
    hourlyTimer = setInterval(
        () => {
            void runHourlyBillingSweep("billing reconciliation sweep failed");
        },
        60 * 60 * 1000,
    );
    inboxTimer = setInterval(() => {
        void runBillingInboxSweep();
    }, 5 * 1000);
    hourlyTimer.unref?.();
    inboxTimer.unref?.();
}
