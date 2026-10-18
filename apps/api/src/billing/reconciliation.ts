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
} from "drizzle-orm";
import { db } from "../db/client";
import {
    billingCheckoutAttempts,
    billingPlanChangeAttempts,
    billingPriceEntries,
    billingSubscriptions,
    organizations,
    planSendReservations,
    sendingDomains,
} from "../db/schema";
import { readBillingConfig } from "./catalog";
import {
    recordRequestedCatalogRevision,
    verifyCatalogAgainstProvider,
} from "./catalog-store";
import { recordBillingMetric } from "./metrics";
import { providerErrorSummary } from "./provider";
import { expireCancelledSubscriptionEntitlements } from "./webhooks/processor";
import { resumeOrganizationCheckoutAttempt } from "./checkout";
import { settleExpiredSendReservation } from "./entitlements";
import { evaluateAllTeamReputations } from "./reputation";
import { verifySendingDomain } from "./domains";
import { evaluateBillingSloAlerts, recordBillingHourlySuccess } from "./alerts";
import logger from "../services/log";

let hourlyTimer: NodeJS.Timeout | undefined;
let inboxTimer: NodeJS.Timeout | undefined;
let hourlyRunning = false;
let inboxRunning = false;

export async function processBillingInboxOnce(now = new Date()): Promise<void> {
    void now;
    const { getBillingEngine } = await import("./engine.js");
    await getBillingEngine().runWebhookInboxBatch({
        workerId: `inbox-${process.pid}`,
        limit: 100,
    });
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
    const { getBillingEngine } = await import("./engine.js");
    const billing = getBillingEngine();
    try {
        await recordRequestedCatalogRevision(config);
        await verifyCatalogAgainstProvider(config);
    } catch (error) {
        logger.error(
            { error: providerErrorSummary(error) },
            "billing catalog verification failed",
        );
        recordBillingMetric("billing.catalog.verify_failed", {});
    }
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    const expired = await billing.runDeadlineBatch({ limit: 100 });
    if (expired)
        logger.info(
            { billing_deadline_processed: expired },
            "billing deadline batch applied",
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
                    eq(
                        billingCheckoutAttempts.billableEntityId,
                        organization.id,
                    ),
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
        .from(billingSubscriptions)
        .where(
            and(
                inArray(billingSubscriptions.status, [
                    "pending",
                    "trialing",
                    "active",
                    "past_due",
                    "cancelled",
                ]),
                or(
                    isNull(billingSubscriptions.lastReconciledAt),
                    lt(billingSubscriptions.lastReconciledAt, cutoff),
                ),
            ),
        )
        .limit(100);
    for (const subscription of subscriptions) {
        await billing.enqueueJob({
            provider: subscription.provider,
            subscriptionId: subscription.id,
        });
    }
    // Retry ambiguous plan-change mutations with the same provider
    // idempotency key. A provider that already applied the request returns the
    // original result; a scheduled change may safely remain pending until its
    // next-billing snapshot arrives.
    const planChanges = await db
        .select({
            attempt: billingPlanChangeAttempts,
            subscription: billingSubscriptions,
            price: billingPriceEntries,
        })
        .from(billingPlanChangeAttempts)
        .innerJoin(
            billingSubscriptions,
            eq(
                billingSubscriptions.id,
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
    for (const { attempt } of planChanges) {
        await billing.enqueueJob({
            provider: attempt.provider,
            planChangeAttemptId: attempt.id,
        });
    }
    await billing.runReconciliationBatch({
        workerId: `reconcile-${process.pid}`,
        limit: 200,
    });
    await billing.purgeExpiredSensitiveValues({
        before: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        limit: 500,
    });
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
