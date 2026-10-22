import { and, eq } from "drizzle-orm";
import { notifyOrganizationOwners } from "../billing/notifications";
import { db } from "../db/client";
import { abuseFlags, organizationPlanPolicies, organizations } from "../db/schema";
import { abuseControlsEnabled, readAbuseConfig } from "./config";
import { raiseAbuseFlag } from "./flags";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hosted check when a broadcast is started through the team's own ESP (#122).
 * A new organization's first broadcast to at least
 * `firstBroadcastReviewRecipients` contacts waits for an operator; once one
 * has been released, later broadcasts aren't held. Sends through a shared
 * mailbox are paced instead (`reserveSend`). Throws
 * `broadcast_held_for_review`.
 */
export async function assertLargeBroadcastReviewed(input: {
  organizationId: string;
  teamId: string;
  deliverySourceType: "organization" | "team";
  sequence: { sequenceId: string; title: string };
  recipients: number;
}): Promise<void> {
  if (!abuseControlsEnabled() || input.deliverySourceType !== "team") return;
  const config = readAbuseConfig();
  if (input.recipients < config.firstBroadcastReviewRecipients) return;

  const [organization] = await db
    .select({
      createdAt: organizations.createdAt,
      publicId: organizations.organizationId,
      pacingExempt: organizationPlanPolicies.pacingExempt,
    })
    .from(organizations)
    .leftJoin(
      organizationPlanPolicies,
      eq(organizationPlanPolicies.organizationId, organizations.id),
    )
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization || organization.pacingExempt) return;
  const ageDays = Math.floor((Date.now() - organization.createdAt.getTime()) / DAY_MS);
  if (ageDays >= config.newAccountDays) return;

  const [released] = await db
    .select({ id: abuseFlags.id })
    .from(abuseFlags)
    .where(
      and(
        eq(abuseFlags.organizationId, input.organizationId),
        eq(abuseFlags.kind, "broadcast"),
        eq(abuseFlags.status, "released"),
      ),
    )
    .limit(1);
  if (released) return;

  const flag = await raiseAbuseFlag({
    organizationId: input.organizationId,
    teamId: input.teamId,
    kind: "broadcast",
    severity: "medium",
    reason: `New account's first large broadcast (${input.recipients} recipients) through its own ESP`,
    details: {
      organization: organization.publicId,
      accountAgeDays: ageDays,
      sequenceId: input.sequence.sequenceId,
      title: input.sequence.title,
      recipients: input.recipients,
    },
  });
  // Tell the owners once, when the flag is new.
  if (Date.now() - flag.createdAt.getTime() < 60_000) {
    await notifyOrganizationOwners(
      input.organizationId,
      `"${input.sequence.title}" is being reviewed before it is sent`,
      `Your first large broadcast ("${input.sequence.title}", ${input.recipients} recipients) needs a quick look from our team before it goes out. This is a one-time check for new accounts and usually takes less than a business day; start the broadcast again once it's approved. Reply to this email if you have questions.`,
    ).catch(() => undefined);
  }
  throw new Error("broadcast_held_for_review");
}
