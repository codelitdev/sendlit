import { and, eq, inArray, lt } from "drizzle-orm";
import {
  feedbackRequirementApplies,
  normalizeSendingDomain,
  organizationAcceptedSends,
  testVolumeThreshold,
} from "../billing/domains";
import { notifyOrganizationOwners } from "../billing/notifications";
import { db } from "../db/client";
import {
  espConfigs,
  espFeedbackConnections,
  organizations,
  sendingDomains,
  teams,
} from "../db/schema";
import { captureError, captureEvent } from "../observability";
import logger from "../services/log";

/** Warnings, in percent of the cloud test volume, emailed to the owners
 * while an ESP still has no feedback connection or a From domain isn't
 * verified. */
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

/** The requirement for the organization a team belongs to; null for an
 * unknown team. */
export async function getFeedbackRequirementForTeam(
  teamId: string,
): Promise<FeedbackRequirement | null> {
  const [team] = await db
    .select({ organizationId: teams.organizationId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team ? getFeedbackRequirement(team.organizationId) : null;
}

/** What `assertSendingEligibility` will stop past the test volume: the
 * organization's active team ESPs without a healthy feedback connection, and
 * their From domains the organization hasn't verified. */
async function unmetSendingRequirements(organizationId: string) {
  const esps = await db
    .select({
      id: espConfigs.id,
      teamId: espConfigs.teamId,
      name: espConfigs.name,
      fromEmail: espConfigs.fromEmail,
    })
    .from(espConfigs)
    .innerJoin(teams, eq(teams.id, espConfigs.teamId))
    .where(
      and(eq(teams.organizationId, organizationId), eq(espConfigs.status, "active")),
    );
  if (esps.length === 0) return { esps: [], domains: [] };
  const [healthy, verified] = await Promise.all([
    db
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
      ),
    db
      .select({ domain: sendingDomains.domain })
      .from(sendingDomains)
      .where(
        and(
          eq(sendingDomains.organizationId, organizationId),
          eq(sendingDomains.status, "verified"),
        ),
      ),
  ]);
  const verifiedDomains = new Set(verified.map((row) => row.domain));
  const domains = new Set<string>();
  for (const esp of esps) {
    const domain = fromDomain(esp.fromEmail);
    if (domain && !verifiedDomains.has(domain)) domains.add(domain);
  }
  return {
    esps: esps
      .filter(
        (esp) =>
          !healthy.some(
            (row) => row.espConfigId === esp.id && row.teamId === esp.teamId,
          ),
      )
      .map((esp) => esp.name),
    domains: [...domains],
  };
}

function fromDomain(fromEmail: string | null): string | null {
  if (!fromEmail) return null;
  try {
    return normalizeSendingDomain(fromEmail.slice(fromEmail.lastIndexOf("@") + 1));
  } catch {
    return null;
  }
}

function noticeText(
  percent: (typeof NOTICE_PERCENTS)[number],
  organizationName: string,
  sent: number,
  threshold: number,
  unmet: { esps: string[]; domains: string[] },
): { subject: string; text: string } {
  const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(", ");
  const todo = [
    ...(unmet.esps.length
      ? [
          `Connect bounce and complaint feedback for ${quoted(unmet.esps)} in Settings → Email service providers (ESP), using the feedback button next to each provider.`,
        ]
      : []),
    ...(unmet.domains.length
      ? [`Verify ${unmet.domains.join(", ")} in Organizations → Sending domains.`]
      : []),
  ].join(" ");
  const rule =
    "SendLit only sends through email providers that report bounces and spam complaints back, and from From domains your organization has verified, so it can protect your sender reputation.";
  if (percent === 100) {
    return {
      subject: `Sending stopped for ${organizationName}: finish setting up sending`,
      text: `${organizationName} has sent ${sent} emails. From here, ${rule} Sending is stopped until that's done; running sequences and broadcasts are paused and keep their queued emails. ${todo} Then resume them.`,
    };
  }
  return {
    subject: `${organizationName} has sent ${sent} of ${threshold} emails: finish setting up sending`,
    text: `${organizationName} has sent ${sent} of its first ${threshold} emails. After ${threshold}, ${rule} Still to do: ${todo} Without this, sending stops after ${threshold} emails.`,
  };
}

/**
 * Emails the organization's owners when it reaches 50%, 90% and 100% of the
 * cloud test volume while one of its ESPs has no feedback connection or a
 * From domain isn't verified, so they can finish before sending stops. Each warning goes out once; it
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
    const unmet = await unmetSendingRequirements(org.id);
    if (unmet.esps.length === 0 && unmet.domains.length === 0) return;
    const { subject, text } = noticeText(reached, org.name, sent, threshold, unmet);
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
      properties: {
        notice_percent: reached,
        esp_count: unmet.esps.length,
        domain_count: unmet.domains.length,
      },
    });
  } catch (error) {
    captureError({
      error,
      source: "delivery_feedback.requirement",
      teamId,
    });
  }
}
