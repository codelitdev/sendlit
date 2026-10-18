import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
    billingCheckoutAttempts,
    billingPlanStates,
    billingSubscriptions,
    billingTrialClaims,
    organizations,
    settings,
    teamDeliverySettings,
    teamMembers,
    teams,
} from "../db/schema";
import { defaultTeamName } from "../organization/default-team-name";
import { notifyPaymentPastDue } from "./notifications";
import type { CanonicalSubscription } from "@codelitdev/billing/core";
import type { DrizzleDb } from "@codelitdev/billing/drizzle";
import type { PlanStateRow } from "@codelitdev/billing/workflows";

type EffectsDb = Pick<typeof db, "select" | "update" | "insert">;

export async function applySendLitProjectionEffects(
    input: {
        material: boolean;
        previous: CanonicalSubscription | null;
        next: CanonicalSubscription;
        planState: PlanStateRow;
    },
    tx: EffectsDb | DrizzleDb = db,
): Promise<void> {
    if (!input.material) return;
    const organizationId = input.next.billableEntityId;
    const active = input.next.isEntitlementSource;
    const nextPlan = active ? input.next.plan : "free";
    const run = async (client: EffectsDb) => {
        const [organization] = await client
            .select({
                id: organizations.id,
                name: organizations.name,
                status: organizations.status,
            })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .limit(1);
        if (!organization) return;
        const [state] = await client
            .select()
            .from(billingPlanStates)
            .where(eq(billingPlanStates.billableEntityId, organizationId))
            .limit(1);
        if (!state) return;
        await client
            .update(billingPlanStates)
            .set({
                plan: nextPlan,
                firstPaidActivatedAt:
                    active && !state.firstPaidActivatedAt
                        ? (input.next.providerOccurredAt ?? new Date())
                        : state.firstPaidActivatedAt,
                updatedAt: new Date(),
            })
            .where(eq(billingPlanStates.id, state.id));
        if (
            input.next.status === "past_due" &&
            input.previous?.status !== "past_due"
        ) {
            await client
                .update(billingSubscriptions)
                .set({
                    pastDueAt: new Date(),
                    graceEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    updatedAt: new Date(),
                })
                .where(eq(billingSubscriptions.id, input.next.id));
        }
        if (active && input.next.originCheckoutAttemptId) {
            const [attempt] = await client
                .select()
                .from(billingCheckoutAttempts)
                .where(
                    eq(
                        billingCheckoutAttempts.id,
                        input.next.originCheckoutAttemptId,
                    ),
                )
                .limit(1);
            if (attempt) {
                await client
                    .update(billingTrialClaims)
                    .set({
                        status: "redeemed",
                        redeemedAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .where(
                        eq(billingTrialClaims.checkoutAttemptId, attempt.id),
                    );
                const [existingTeam] = await client
                    .select({ id: teams.id })
                    .from(teams)
                    .where(eq(teams.organizationId, organizationId))
                    .limit(1);
                if (!existingTeam) {
                    const [team] = await client
                        .insert(teams)
                        .values({
                            organizationId,
                            name:
                                attempt.pendingTeamName ||
                                defaultTeamName(organization.name),
                        })
                        .returning();
                    if (team) {
                        await client
                            .insert(settings)
                            .values({ teamId: team.id });
                        await client
                            .insert(teamDeliverySettings)
                            .values({ teamId: team.id });
                        await client.insert(teamMembers).values({
                            teamId: team.id,
                            userId: attempt.payerId,
                            role: "admin",
                        });
                    }
                }
            }
        }
        await client
            .update(organizations)
            .set({
                status:
                    organization.status === "pending_payment" && !active
                        ? "pending_payment"
                        : "active",
                updatedAt: new Date(),
            })
            .where(eq(organizations.id, organizationId));
    };
    if (tx === db) {
        await db.transaction((nested) => run(nested));
    } else {
        await run(tx as EffectsDb);
    }
    if (
        input.next.status === "past_due" &&
        input.previous?.status !== "past_due"
    ) {
        await notifyPaymentPastDue(organizationId, null).catch(() => undefined);
    }
}
