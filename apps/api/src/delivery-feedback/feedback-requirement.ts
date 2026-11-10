import { and, eq, inArray, lt } from "drizzle-orm";
import {
  feedbackRequirementApplies,
  organizationAcceptedSends,
  testVolumeThreshold,
} from "../billing/domains";
import { notifyOrganizationOwners } from "../billing/notifications";
import { db } from "../db/client";
import { espConfigs, espFeedbackConnections, organizations, teams } from "../db/schema";
import { captureError, captureEvent } from "../observability";
import logger from "../services/log";

/** Warnings, in percent of the cloud test volume, emailed to the owners
 * while an ESP still has no feedback connection. */
const NOTICE_PERCENTS = [50, 90, 100] as const;

export type FeedbackRequirement = {
  /** Whether ESPs need a healthy bounce/complaint feedback connection once
   * the organization has sent `requiredAfterSends` emails (SendLit Cloud). */
  required: boolean;
  requiredAfterSends: number;
  /** Emails the organization has sent so far, across all its teams. */
  sentSoFar: number;
};

export async function getFeedbackRequirement(
  organizationId: string,
): Promise<FeedbackRequirement> {
  const required = feedbackRequirementApplies();
  return {
    required,
    requiredAfterSends: testVolumeThreshold(),
    sentSoFar: required ? await organizationAcceptedSends(organizationId) : 0,
  };
}

/** The organization's active team ESPs without a healthy feedback
 * connection: the ones `assertSendingEligibility` stops past the test
 * volume. */
async function espsWithoutFeedback(organizationId: string) {
  const esps = await db
    .select({ id: espConfigs.id, teamId: espConfigs.teamId, name: espConfigs.name })
    .from(espConfigs)
    .innerJoin(teams, eq(teams.id, espConfigs.teamId))
    .where(
      and(eq(teams.organizationId, organizationId), eq(espConfigs.status, "active")),
    );
  if (esps.length === 0) return [];
  const healthy = await db
    .select({
      teamId: espFeedbackConnections.teamId,
      espConfigId: espFeedbackConnections.espConfigId,
    })
    .from(espFeedbackConnections)
    .where(
      and(
        inArray(
          espFeedbackConnections.espConfigId,
          esps.map((esp) => esp.id),
        ),
        eq(espFeedbackConnections.status, "healthy"),
      ),
    );
  return esps.filter(
    (esp) =>
      !healthy.some((row) => row.espConfigId === esp.id && row.teamId === esp.teamId),
  );
}

function noticeText(
  percent: (typeof NOTICE_PERCENTS)[number],
  organizationName: string,
  sent: number,
  threshold: number,
  espNames: string[],
): { subject: string; text: string } {
  const esps = espNames.map((name) => `"${name}"`).join(", ");
  const how =
    "Connect bounce and complaint feedback for it in Settings → Email service providers (ESP), using the feedback button next to the provider.";
  if (percent === 100) {
    return {
      subject: `Sending stopped for ${organizationName}: connect bounce and complaint feedback`,
      text: `${organizationName} has sent ${sent} emails, so SendLit now needs your email provider to report bounces and spam complaints back before it sends more. Sending through ${esps} is stopped until it does; running sequences and broadcasts are paused and keep their queued emails. ${how} Then resume them.`,
    };
  }
  return {
    subject: `${organizationName} has sent ${sent} of ${threshold} emails: connect bounce and complaint feedback`,
    text: `${organizationName} has sent ${sent} of its first ${threshold} emails. After ${threshold}, SendLit only sends through an email provider that reports bounces and spam complaints back, so it can protect your sender reputation, and ${esps} doesn't yet. ${how} Without it, sending through it stops after ${threshold} emails.`,
  };
}

/**
 * Emails the organization's owners when it reaches 50%, 90% and 100% of the
 * cloud test volume while one of its ESPs has no feedback connection, so
 * they can connect it before sending stops. Each warning goes out once; it
 * runs after every accepted send, and costs nothing once all three are past.
 * Never throws: the email it follows has already gone out.
 */
export async function notifyFeedbackMilestones(teamId: string): Promise<void> {
  if (!feedbackRequirementApplies()) return;
  try {
    const [org] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        noticePercent: organizations.feedbackNoticePercent,
      })
      .from(teams)
      .innerJoin(organizations, eq(organizations.id, teams.organizationId))
      .where(eq(teams.id, teamId))
      .limit(1);
    if (!org || org.noticePercent >= 100) return;
    const threshold = testVolumeThreshold();
    const sent = await organizationAcceptedSends(org.id);
    const reached = NOTICE_PERCENTS.filter(
      (percent) => sent * 100 >= percent * threshold,
    ).at(-1);
    if (!reached || reached <= org.noticePercent) return;
    // Claim the warning first, so concurrent sends email it only once.
    const [claimed] = await db
      .update(organizations)
      .set({ feedbackNoticePercent: reached })
      .where(
        and(
          eq(organizations.id, org.id),
          lt(organizations.feedbackNoticePercent, reached),
        ),
      )
      .returning({ id: organizations.id });
    if (!claimed) return;
    const missing = await espsWithoutFeedback(org.id);
    if (missing.length === 0) return;
    const { subject, text } = noticeText(
      reached,
      org.name,
      sent,
      threshold,
      missing.map((esp) => esp.name),
    );
    try {
      await notifyOrganizationOwners(org.id, subject, text);
    } catch (error) {
      // Release the claim so a later send tries this warning again.
      await db
        .update(organizations)
        .set({ feedbackNoticePercent: org.noticePercent })
        .where(
          and(
            eq(organizations.id, org.id),
            eq(organizations.feedbackNoticePercent, reached),
          ),
        );
      throw error;
    }
    logger.info(
      { organization_id: org.id, notice_percent: reached },
      "feedback connection reminder sent",
    );
    captureEvent({
      event: "feedback_connection_reminder_sent",
      source: "delivery_feedback.requirement",
      teamId,
      properties: { notice_percent: reached, esp_count: missing.length },
    });
  } catch (error) {
    captureError({
      error,
      source: "delivery_feedback.requirement",
      teamId,
    });
  }
}
