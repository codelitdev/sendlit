import { and, eq, inArray, lte, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import {
    billingCheckoutAttempts,
    billingPlanChangeAttempts,
    billingPriceEntries,
    billingProviderCustomers,
    billingTrialClaims,
    billingWebhookEvents,
    organizationAuditEvents,
    billingPlanStates,
    billingSubscriptions,
    organizations,
    settings,
    teamDeliverySettings,
    teamMembers,
    teams,
} from "../../db/schema";
import {
    decideSubscriptionTransition,
    retainsPaidEntitlement as packageRetainsPaidEntitlement,
    type CanonicalSubscriptionStatus,
} from "@codelitdev/billing/core";
import { providerErrorSummary, type CanonicalBillingEvent } from "../provider";
import { decryptBillingValue } from "../crypto";
import { getBillingProvider } from "../provider-registry";
import { billingWebhookRetry } from "../webhook-retry";
import { defaultTeamName } from "../../organization/default-team-name";
import logger from "../../services/log";
import { notifyPaymentPastDue } from "../notifications";
import { pageBillingAlert } from "../alerts";

function checkoutAttemptIdFromSnapshot(snapshot: {
    metadata: Record<string, string | undefined>;
}): string | undefined {
    return (
        snapshot.metadata.checkoutAttemptId ??
        snapshot.metadata.sendlitCheckoutAttemptId
    );
}

/** Apply a provider snapshot atomically. Events are merely wake-up signals;
 * the Dodo adapter has already retrieved the current subscription state. */
export async function applyCanonicalBillingEvent(
    event: CanonicalBillingEvent,
): Promise<void> {
    if (!event.snapshot || !event.subscriptionId) return;
    const snapshot = event.snapshot;
    const pastDueNotice: Array<{
        organizationId: string;
        graceEndsAt: Date | null;
    }> = [];
    await db.transaction(async (tx) => {
        const [price] = await tx
            .select()
            .from(billingPriceEntries)
            .where(
                and(
                    eq(billingPriceEntries.provider, event.provider),
                    eq(
                        billingPriceEntries.providerProductId,
                        snapshot.providerProductId,
                    ),
                ),
            )
            .limit(1);
        if (!price) throw new Error("billing_unknown_provider_product");

        const [existing] = await tx
            .select()
            .from(billingSubscriptions)
            .where(
                and(
                    eq(billingSubscriptions.provider, event.provider),
                    eq(
                        billingSubscriptions.providerSubscriptionId,
                        snapshot.providerSubscriptionId,
                    ),
                ),
            )
            .limit(1)
            .for("update");
        let attempt = null as
            typeof billingCheckoutAttempts.$inferSelect | null;
        const checkoutAttemptId = checkoutAttemptIdFromSnapshot(snapshot);
        if (!existing && checkoutAttemptId) {
            const [row] = await tx
                .select()
                .from(billingCheckoutAttempts)
                .where(eq(billingCheckoutAttempts.attemptId, checkoutAttemptId))
                .limit(1)
                .for("update");
            attempt = row ?? null;
        }
        const organizationId =
            existing?.billableEntityId ?? attempt?.billableEntityId;
        const billingCustomerId =
            existing?.billingCustomerId ?? attempt?.billingCustomerId;
        const billingManagerUserId = existing?.payerId ?? attempt?.payerId;
        if (!organizationId || !billingCustomerId || !billingManagerUserId) {
            throw new Error("billing_subscription_unmatched");
        }
        const [organization] = await tx
            .select({
                id: organizations.id,
                name: organizations.name,
                status: organizations.status,
            })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1)
            .for("update");
        if (!organization) throw new Error("billing_organization_missing");
        if (
            organization.status === "abandoned" ||
            organization.status === "closed"
        ) {
            if (attempt) {
                await tx
                    .update(billingCheckoutAttempts)
                    .set({
                        status: "conflicted",
                        lastError: "billing_organization_not_activatable",
                        updatedAt: new Date(),
                    })
                    .where(eq(billingCheckoutAttempts.id, attempt.id));
            }
            throw new Error("billing_organization_not_activatable");
        }
        const [customer] = await tx
            .select({
                id: billingProviderCustomers.id,
                providerCustomerId: billingProviderCustomers.providerCustomerId,
            })
            .from(billingProviderCustomers)
            .where(eq(billingProviderCustomers.id, billingCustomerId))
            .limit(1);
        if (
            !customer ||
            customer.providerCustomerId !== snapshot.providerCustomerId
        ) {
            throw new Error("billing_customer_mismatch");
        }
        const [state] = await tx
            .select()
            .from(billingPlanStates)
            .where(eq(billingPlanStates.billableEntityId, organizationId))
            .limit(1)
            .for("update");
        if (!state) throw new Error("organization_plan_state_missing");
        // Ordering follows the authoritative subscription snapshot. Dodo
        // webhook timestamps can be delayed, while retrieveSubscription gives
        // the current state and timestamp used for this projection.
        const providerOccurredAt =
            snapshot.providerOccurredAt ?? snapshot.observedAt;
        if (
            existing?.providerOccurredAt &&
            snapshot.providerOccurredAt &&
            existing.providerOccurredAt > snapshot.providerOccurredAt
        )
            return;
        if (existing) {
            const decision = decideSubscriptionTransition(
                existing.status as CanonicalSubscriptionStatus,
                snapshot.status,
            );
            if (!decision.allowed) {
                throw new Error("billing_invalid_subscription_transition");
            }
        }
        const catalogKey = price.offerKey;
        const now = new Date();
        const retainsPaidEntitlement = packageRetainsPaidEntitlement(
            snapshot,
            now,
        );
        const graceEndsAt =
            snapshot.status === "past_due"
                ? existing?.status === "past_due" && existing.graceEndsAt
                    ? existing.graceEndsAt
                    : new Date(
                          providerOccurredAt.getTime() +
                              7 * 24 * 60 * 60 * 1000,
                      )
                : null;
        if (snapshot.status === "past_due" && existing?.status !== "past_due") {
            pastDueNotice.push({ organizationId, graceEndsAt });
        }
        const pastDueAt =
            snapshot.status === "past_due"
                ? existing?.status === "past_due" && existing.pastDueAt
                    ? existing.pastDueAt
                    : providerOccurredAt
                : null;
        const isCurrentSubscription =
            !state.activeSubscriptionId ||
            state.activeSubscriptionId === existing?.id;
        if (retainsPaidEntitlement && !isCurrentSubscription) {
            throw new Error("billing_conflicting_subscription_source");
        }
        // Historical subscriptions may continue to emit terminal events. They
        // are recorded above, but must never clear or replace the organization's
        // current entitlement projection.
        const shouldProject =
            isCurrentSubscription &&
            (retainsPaidEntitlement ||
                state.activeSubscriptionId === existing?.id);
        const values = {
            billableEntityId: organizationId,
            billingCustomerId,
            payerId: billingManagerUserId,
            provider: event.provider,
            providerSubscriptionId: snapshot.providerSubscriptionId,
            providerProductId: snapshot.providerProductId,
            billingPriceEntryId: price.id,
            catalogRevision:
                existing?.catalogRevision ?? attempt?.catalogRevision ?? 0,
            offerKey: catalogKey,
            plan: price.plan,
            billingInterval: price.billingInterval,
            status: snapshot.status,
            currentPeriodStartsAt: snapshot.currentPeriodStartsAt,
            currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
            paidThroughAt: snapshot.paidThroughAt,
            trialEndsAt: snapshot.trialEndsAt,
            pastDueAt,
            graceEndsAt,
            cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
            isEntitlementSource: shouldProject && retainsPaidEntitlement,
            providerOccurredAt: providerOccurredAt,
            lastReconciledAt: new Date(),
            updatedAt: new Date(),
        } as const;
        const [subscription] = existing
            ? await tx
                  .update(billingSubscriptions)
                  .set(values)
                  .where(eq(billingSubscriptions.id, existing.id))
                  .returning()
            : await tx.insert(billingSubscriptions).values(values).returning();
        if (!subscription)
            throw new Error("billing_subscription_projection_failed");
        // Only one subscription can grant entitlements.  A newly active one
        // supersedes a prior terminal/old source; conflicting active sources
        // are rejected by the database partial unique index.
        if (shouldProject) {
            await tx
                .update(billingSubscriptions)
                .set({ isEntitlementSource: false, updatedAt: new Date() })
                .where(
                    and(
                        eq(
                            billingSubscriptions.billableEntityId,
                            organizationId,
                        ),
                        eq(billingSubscriptions.isEntitlementSource, true),
                    ),
                );
            if (retainsPaidEntitlement) {
                await tx
                    .update(billingSubscriptions)
                    .set({ isEntitlementSource: true, updatedAt: new Date() })
                    .where(eq(billingSubscriptions.id, subscription.id));
            }
        }
        const active = shouldProject && retainsPaidEntitlement;
        const nextPlan = active ? (price.plan as "pro" | "business") : "free";
        const nextSubscriptionId = active ? subscription.id : null;
        if (shouldProject) {
            await tx
                .update(billingPlanStates)
                .set({
                    plan: nextPlan,
                    activeSubscriptionId: nextSubscriptionId,
                    firstPaidActivatedAt:
                        active && !state.firstPaidActivatedAt
                            ? providerOccurredAt
                            : state.firstPaidActivatedAt,
                    projectionVersion: state.projectionVersion + 1,
                    updatedAt: new Date(),
                })
                .where(eq(billingPlanStates.id, state.id));
            if (
                state.plan !== nextPlan ||
                state.activeSubscriptionId !== nextSubscriptionId
            ) {
                await tx.insert(organizationAuditEvents).values({
                    organizationId,
                    actorType: "system",
                    action: "billing.plan_projection_changed",
                    metadata: {
                        previousPlan: state.plan,
                        nextPlan,
                        previousSubscriptionId: state.activeSubscriptionId,
                        nextSubscriptionId,
                        provider: event.provider,
                    },
                });
            }
        }
        // A plan-change attempt is completed only when the signed provider
        // snapshot shows the requested product on the same subscription. This
        // keeps entitlements and the mutation status on one source of truth.
        if (existing && shouldProject && retainsPaidEntitlement) {
            await tx
                .update(billingPlanChangeAttempts)
                .set({
                    status: "succeeded",
                    completedAt: new Date(),
                    paymentUrlEncrypted: null,
                    lastError: null,
                    updatedAt: new Date(),
                })
                .where(
                    and(
                        eq(
                            billingPlanChangeAttempts.subscriptionId,
                            subscription.id,
                        ),
                        eq(billingPlanChangeAttempts.provider, event.provider),
                        eq(
                            billingPlanChangeAttempts.targetBillingPriceEntryId,
                            price.id,
                        ),
                        inArray(billingPlanChangeAttempts.status, [
                            "creating",
                            "pending",
                        ]),
                    ),
                );
        }
        if (attempt && active) {
            await tx
                .update(billingCheckoutAttempts)
                .set({
                    status: "completed",
                    completedAt: new Date(),
                    updatedAt: new Date(),
                    checkoutUrlEncrypted: null,
                })
                .where(eq(billingCheckoutAttempts.id, attempt.id));
            await tx
                .update(billingTrialClaims)
                .set({
                    status: "redeemed",
                    redeemedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(billingTrialClaims.checkoutAttemptId, attempt.id));
            const [existingTeam] = await tx
                .select({ id: teams.id })
                .from(teams)
                .where(eq(teams.organizationId, organizationId))
                .limit(1);
            if (!existingTeam) {
                const [team] = await tx
                    .insert(teams)
                    .values({
                        organizationId,
                        name:
                            attempt.pendingTeamName ||
                            defaultTeamName(organization.name),
                    })
                    .returning();
                await tx.insert(settings).values({ teamId: team.id });
                await tx
                    .insert(teamDeliverySettings)
                    .values({ teamId: team.id });
                await tx.insert(teamMembers).values({
                    teamId: team.id,
                    userId: attempt.payerId,
                    role: "admin",
                });
            }
        }
        if (shouldProject) {
            await tx
                .update(organizations)
                .set({
                    // A paid-org activation makes the pending row selectable.
                    // A cancellation/expiry returns it to ordinary Free
                    // operation; it must not strand the organization in a
                    // suspended state.
                    status:
                        organization.status === "pending_payment" && !active
                            ? "pending_payment"
                            : "active",
                    updatedAt: new Date(),
                })
                .where(eq(organizations.id, organizationId));
        }
    });
    if (pastDueNotice[0]) {
        await notifyPaymentPastDue(
            pastDueNotice[0].organizationId,
            pastDueNotice[0].graceEndsAt,
        ).catch(() => undefined);
    }
}

/** Project scheduled cancellations to Free once their verified paid-through
 * deadline has passed. This runs under the organization and subscription
 * locks, so a simultaneous resume webhook cannot be lost. */
export async function expireCancelledSubscriptionEntitlements(
    now = new Date(),
): Promise<number> {
    const due = await db
        .select({
            id: billingSubscriptions.id,
            organizationId: billingSubscriptions.billableEntityId,
        })
        .from(billingSubscriptions)
        .where(
            and(
                eq(billingSubscriptions.status, "cancelled"),
                eq(billingSubscriptions.isEntitlementSource, true),
                lte(billingSubscriptions.paidThroughAt, now),
            ),
        )
        .limit(500);
    let expired = 0;
    for (const row of due) {
        const applied = await db.transaction(async (tx) => {
            const [subscription] = await tx
                .select()
                .from(billingSubscriptions)
                .where(eq(billingSubscriptions.id, row.id))
                .limit(1)
                .for("update");
            if (
                !subscription ||
                subscription.status !== "cancelled" ||
                !subscription.isEntitlementSource ||
                !subscription.paidThroughAt ||
                subscription.paidThroughAt > now
            )
                return false;
            await tx
                .select({ id: organizations.id })
                .from(organizations)
                .where(eq(organizations.id, row.organizationId))
                .limit(1)
                .for("update");
            const [state] = await tx
                .select()
                .from(billingPlanStates)
                .where(
                    eq(billingPlanStates.billableEntityId, row.organizationId),
                )
                .limit(1)
                .for("update");
            if (!state || state.activeSubscriptionId !== subscription.id)
                return false;
            await tx
                .update(billingSubscriptions)
                .set({ isEntitlementSource: false, updatedAt: now })
                .where(eq(billingSubscriptions.id, subscription.id));
            await tx
                .update(billingPlanStates)
                .set({
                    plan: "free",
                    activeSubscriptionId: null,
                    projectionVersion: state.projectionVersion + 1,
                    updatedAt: now,
                })
                .where(eq(billingPlanStates.id, state.id));
            await tx.insert(organizationAuditEvents).values({
                organizationId: row.organizationId,
                actorType: "system",
                action: "billing.plan_expired",
                metadata: {
                    subscriptionId: subscription.id,
                    paidThroughAt: subscription.paidThroughAt.toISOString(),
                },
            });
            return true;
        });
        if (applied) expired += 1;
    }
    return expired;
}

/** Claim one durable billing inbox row. Expired leases are reclaimed after a
 * worker crash; retry attempts are bounded before quarantine. */
export async function claimBillingWebhookEvent(
    eventId: string,
    now = new Date(),
): Promise<boolean> {
    const lease = new Date(now.getTime() + 5 * 60 * 1000);
    const [claimed] = await db
        .update(billingWebhookEvents)
        .set({
            status: "processing",
            processingAttempts: sql`${billingWebhookEvents.processingAttempts} + 1`,
            lockedAt: now,
            leaseExpiresAt: lease,
            workerId: `billing-${process.pid}`,
        })
        .where(
            and(
                eq(billingWebhookEvents.id, eventId),
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
            ),
        )
        .returning({ id: billingWebhookEvents.id });
    return Boolean(claimed);
}

export async function processBillingWebhookInboxEvent(
    eventId: string,
    parsedEvent?: CanonicalBillingEvent,
): Promise<void> {
    try {
        const [row] = await db
            .select()
            .from(billingWebhookEvents)
            .where(eq(billingWebhookEvents.id, eventId))
            .limit(1);
        if (!row) return;
        let event = parsedEvent;
        const provider = getBillingProvider(row.provider);
        if (!event) {
            if (!row.payloadEncrypted)
                throw new Error("billing_webhook_payload_missing");
            const encrypted = decryptBillingValue(row.payloadEncrypted);
            let body = encrypted;
            let headers: Record<string, string> = {};
            try {
                const envelope = JSON.parse(encrypted) as {
                    body?: unknown;
                    headers?: unknown;
                    canonical?: {
                        provider: string;
                        providerEventId: string;
                        eventType: string;
                        occurredAt: string;
                        subscriptionId?: string | null;
                        verifiedKeyVersion?: string | null;
                        correlationMetadata?: {
                            checkoutAttemptId?: string;
                            catalogKey?: string;
                        };
                    };
                };
                if (envelope.canonical) {
                    const canonical = envelope.canonical;
                    event = {
                        provider: canonical.provider,
                        providerEventId: canonical.providerEventId,
                        eventType: canonical.eventType,
                        occurredAt: new Date(canonical.occurredAt),
                        subscriptionId: canonical.subscriptionId ?? null,
                        verifiedKeyVersion:
                            canonical.verifiedKeyVersion ?? null,
                        correlationMetadata:
                            canonical.correlationMetadata ?? {},
                    };
                }
                if (typeof envelope.body === "string") {
                    body = envelope.body;
                    if (
                        envelope.headers &&
                        typeof envelope.headers === "object"
                    ) {
                        headers = envelope.headers as Record<string, string>;
                    }
                }
            } catch {
                // Rows written before header-envelope storage retain the raw
                // body; they remain available for operator replay.
            }
            if (!event) {
                event = await provider.parseWebhook({
                    body,
                    headers,
                });
            }
        }
        // Signed webhooks are durable wake-up signals. Always project the
        // provider's current subscription snapshot, including for a replayed
        // canonical envelope, so delayed events cannot roll state backwards.
        if (event.subscriptionId) {
            event.snapshot = await provider.retrieveSubscription(
                event.subscriptionId,
            );
        }
        await applyCanonicalBillingEvent(event);
        await db
            .update(billingWebhookEvents)
            .set({
                status: "processed",
                processedAt: new Date(),
                leaseExpiresAt: null,
            })
            .where(eq(billingWebhookEvents.id, eventId));
    } catch (error) {
        const [row] = await db
            .select({
                processingAttempts: billingWebhookEvents.processingAttempts,
            })
            .from(billingWebhookEvents)
            .where(eq(billingWebhookEvents.id, eventId))
            .limit(1);
        const attempts = Number(row?.processingAttempts ?? 1);
        const retry = billingWebhookRetry(attempts);
        const terminal = retry.status === "quarantined";
        await db
            .update(billingWebhookEvents)
            .set({
                status: terminal ? "quarantined" : "failed",
                lastError: providerErrorSummary(error),
                ...(retry.status === "failed"
                    ? { availableAt: new Date(Date.now() + retry.delayMs) }
                    : {}),
                leaseExpiresAt: null,
            })
            .where(eq(billingWebhookEvents.id, eventId));
        logger[terminal ? "error" : "warn"](
            {
                billing_webhook_event_id: eventId,
                processing_attempts: attempts,
                error: providerErrorSummary(error),
            },
            terminal
                ? "billing webhook quarantined"
                : "billing webhook retry scheduled",
        );
        if (terminal) {
            await pageBillingAlert({
                code: "webhook_quarantined",
                message:
                    "A billing webhook event is quarantined and needs operator review.",
                details: { count: 1 },
            }).catch(() => undefined);
            throw error;
        }
    }
}
