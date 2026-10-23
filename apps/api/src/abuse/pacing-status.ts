import { and, count, eq } from "drizzle-orm";
import { getOrganizationEntitlements } from "../billing/entitlements";
import { marketingRampDailyLimit } from "../billing/policies";
import { db } from "../db/client";
import {
  ongoingSequences,
  organizationPlanPolicies,
  organizations,
  type sequences,
  teams,
} from "../db/schema";
import { abuseControlsEnabled } from "./config";
import { pacedCompletionEstimate, pacingBudget } from "./pacing";

export type SequencePacing = {
  reason: "new_account";
  hourlyLimit: number;
  dailyLimit: number;
  remaining: number;
  estimatedCompletionAt: string;
};

/** Whether a running broadcast is being sent gradually because its
 * organization is new and it goes through a shared mailbox, with how many
 * emails are left and roughly when the last goes out. */
export async function broadcastPacing(
  sequence: Pick<
    typeof sequences.$inferSelect,
    "id" | "teamId" | "type" | "status" | "deliverySourceType"
  >,
): Promise<SequencePacing | null> {
  if (!abuseControlsEnabled()) return null;
  if (sequence.type !== "broadcast" || sequence.status !== "active") return null;
  // Only sends through a shared mailbox are paced (`reserveSend`).
  if (sequence.deliverySourceType !== "organization") return null;
  const [context] = await db
    .select({
      organizationId: organizations.id,
      createdAt: organizations.createdAt,
      pacingExempt: organizationPlanPolicies.pacingExempt,
      rampStage: organizationPlanPolicies.marketingRampStage,
    })
    .from(teams)
    .innerJoin(organizations, eq(organizations.id, teams.organizationId))
    .leftJoin(
      organizationPlanPolicies,
      eq(organizationPlanPolicies.organizationId, organizations.id),
    )
    .where(eq(teams.id, sequence.teamId))
    .limit(1);
  if (!context) return null;
  const entitlements = await getOrganizationEntitlements(context.organizationId);
  if (!entitlements.fairUse) return null;
  const budget = pacingBudget({
    organizationCreatedAt: context.createdAt,
    pacingExempt: context.pacingExempt ?? false,
    rampDailyLimit: context.pacingExempt
      ? null
      : marketingRampDailyLimit(context.rampStage ?? 0),
    monthlySendsLimit: entitlements.monthlySendsLimit,
  });
  if (!budget) return null;
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(ongoingSequences)
    .where(and(eq(ongoingSequences.sequenceId, sequence.id)));
  if (Number(remaining) === 0) return null;
  return {
    reason: "new_account",
    hourlyLimit: budget.hourlyLimit,
    dailyLimit: budget.dailyLimit,
    remaining: Number(remaining),
    estimatedCompletionAt: pacedCompletionEstimate(
      Number(remaining),
      budget,
    ).toISOString(),
  };
}
