import type { CanonicalSubscription } from "@codelitdev/billing/core";
import type { DrizzleDb } from "@codelitdev/billing/drizzle";
import type { PlanStateRow } from "@codelitdev/billing/workflows";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  organizationPlanPolicies,
  organizations,
  settings,
  teamDeliverySettings,
  teamMembers,
  teams,
  trialClaims,
} from "../db/schema";
import { recordOrganizationAuditEvent } from "../organization/audit";
import { defaultTeamName } from "../organization/default-team-name";
import logger from "../services/log";
import { notifyPaymentPastDue } from "./notifications";
import { pastDueGraceEndsAt } from "./policies";

type EffectsDb = Pick<typeof db, "select" | "update" | "insert">;

/** Organizations a billing projection must never (re)activate. `abandoned`
 * and `closed` are terminal; `suspended` is an operator decision that a
 * payment does not override. */
const NOT_ACTIVATABLE = new Set(["abandoned", "closed", "suspended"]);

/**
 * SendLit's product work after the engine projects a subscription. Paid state
 * itself (plan, interval, status) lives only in the engine and is read with
 * `commercialState`; this hook never copies it, and it writes only SendLit's
 * own tables. It runs inside the engine's projection transaction, including
 * lapses released by the deadline batch and by `startCheckout` (then
 * `next.isEntitlementSource` is false).
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
    active && input.next.status === "past_due" && input.previous?.status !== "past_due";
  const leftPastDue =
    input.next.status !== "past_due" && input.previous?.status === "past_due";
  let notifyPastDue: Date | null = null;
  const run = async (client: EffectsDb) => {
    const [organization] = await client
      .select({
        id: organizations.id,
        name: organizations.name,
        status: organizations.status,
        pendingTeamName: organizations.pendingTeamName,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!organization) return;
    const activatable = !NOT_ACTIVATABLE.has(organization.status);
    if (enteredPastDue || leftPastDue) {
      // SendLit's 7-day past-due sending grace, layered on the engine's
      // past_due status (which keeps paid access until dunning ends).
      const now = new Date();
      const pastDueSince = enteredPastDue ? now : null;
      await client
        .insert(organizationPlanPolicies)
        .values({ organizationId, pastDueSince })
        .onConflictDoUpdate({
          target: organizationPlanPolicies.organizationId,
          set: { pastDueSince, updatedAt: now },
        });
      if (enteredPastDue && !["abandoned", "closed"].includes(organization.status)) {
        notifyPastDue = pastDueGraceEndsAt(pastDueSince);
      }
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
      await client
        .update(trialClaims)
        .set({
          status: "redeemed",
          redeemedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(trialClaims.checkoutAttemptId, input.next.originCheckoutAttemptId));
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
              name: organization.pendingTeamName || defaultTeamName(organization.name),
            })
            .returning();
          if (team) {
            await client.insert(settings).values({ teamId: team.id });
            await client.insert(teamDeliverySettings).values({ teamId: team.id });
            await client.insert(teamMembers).values({
              teamId: team.id,
              userId: input.next.payerId,
              role: "admin",
            });
          }
        }
        if (organization.pendingTeamName !== null) {
          await client
            .update(organizations)
            .set({ pendingTeamName: null, updatedAt: new Date() })
            .where(eq(organizations.id, organizationId));
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
    void notifyPaymentPastDue(organizationId, notifyPastDue).catch(() => undefined);
  }
}
