import type { CanonicalSubscription } from "@codelitdev/billing/core";
import type { DrizzleDb } from "@codelitdev/billing/drizzle";
import type { PlanStateRow } from "@codelitdev/billing/workflows";
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
import { recordOrganizationAuditEvent } from "../organization/audit";
import { defaultTeamName } from "../organization/default-team-name";
import logger from "../services/log";
import { notifyPaymentPastDue } from "./notifications";

type EffectsDb = Pick<typeof db, "select" | "update" | "insert">;

/** Organizations a billing projection must never (re)activate. `abandoned`
 * and `closed` are terminal; `suspended` is an operator decision that a
 * payment does not override. */
const NOT_ACTIVATABLE = new Set(["abandoned", "closed", "suspended"]);

/**
 * SendLit's product work after the engine projects a subscription. Paid state
 * itself (plan, interval, status) lives only in the engine and is read with
 * `commercialState`; this hook never copies it. It runs inside the engine's
 * projection transaction, including lapses released by the deadline batch
 * and by `startCheckout` (then `next.isEntitlementSource` is false).
 */
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
  const enteredPastDue =
    input.next.status === "past_due" && input.previous?.status !== "past_due";
  let notifyPastDue = false;
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
    const activatable = !NOT_ACTIVATABLE.has(organization.status);
    const [state] = await client
      .select({
        id: billingPlanStates.id,
        firstPaidActivatedAt: billingPlanStates.firstPaidActivatedAt,
      })
      .from(billingPlanStates)
      .where(eq(billingPlanStates.billableEntityId, organizationId))
      .limit(1);
    if (state && active && !state.firstPaidActivatedAt) {
      await client
        .update(billingPlanStates)
        .set({
          firstPaidActivatedAt: input.next.providerOccurredAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(billingPlanStates.id, state.id));
    }
    if (enteredPastDue) {
      // SendLit's 7-day dunning grace, layered on the provider's past_due.
      await client
        .update(billingSubscriptions)
        .set({
          pastDueAt: new Date(),
          graceEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(billingSubscriptions.id, input.next.id));
      notifyPastDue = !["abandoned", "closed"].includes(organization.status);
    }
    if (active && !activatable) {
      // A late payment for an organization the owner abandoned or closed, or
      // that an operator suspended. Never reactivate it; an operator must
      // refund or cancel the subscription.
      logger.error(
        {
          billing_subscription: input.next.id,
          organization_status: organization.status,
        },
        "paid billing projection for an organization that cannot be activated",
      );
      await recordOrganizationAuditEvent(client, {
        organizationId,
        actor: { type: "system" },
        action: "billing.paid_for_inactive_organization",
        metadata: {
          subscriptionId: input.next.id,
          organizationStatus: organization.status,
        },
      });
    }
    if (active && input.next.originCheckoutAttemptId) {
      const [attempt] = await client
        .select()
        .from(billingCheckoutAttempts)
        .where(eq(billingCheckoutAttempts.id, input.next.originCheckoutAttemptId))
        .limit(1);
      if (attempt) {
        await client
          .update(billingTrialClaims)
          .set({
            status: "redeemed",
            redeemedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(billingTrialClaims.checkoutAttemptId, attempt.id));
        if (activatable) {
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
                name: attempt.pendingTeamName || defaultTeamName(organization.name),
              })
              .returning();
            if (team) {
              await client.insert(settings).values({ teamId: team.id });
              await client.insert(teamDeliverySettings).values({ teamId: team.id });
              await client.insert(teamMembers).values({
                teamId: team.id,
                userId: attempt.payerId,
                role: "admin",
              });
            }
          }
        }
      }
    }
    if (active && organization.status === "pending_payment") {
      await client
        .update(organizations)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(organizations.id, organizationId));
    }
  };
  if (tx === db) {
    await db.transaction((nested) => run(nested));
  } else {
    await run(tx as EffectsDb);
  }
  if (notifyPastDue) {
    // Not awaited: SMTP must not hold the projection transaction open.
    void notifyPaymentPastDue(organizationId, null).catch(() => undefined);
  }
}
