import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { outboundMessages, teams } from "../db/schema";
import { getTeamsQuotaUsage } from "../delivery/quota";
import { getTeamsHealth } from "../delivery/team-health";

export const MAIL_ACTIVITY_RANGE_DAYS = [1, 3, 7, 30] as const;
export type MailActivityRangeDays = (typeof MAIL_ACTIVITY_RANGE_DAYS)[number];

export type OrganizationMailCounts = {
  sent: number;
  queued: number;
  failed: number;
  bounced: number;
  complained: number;
};

function emptyCounts(): OrganizationMailCounts {
  return { sent: 0, queued: 0, failed: 0, bounced: 0, complained: 0 };
}

const MAIL_COUNT_KEYS = ["sent", "queued", "failed", "bounced", "complained"] as const;

function iso<T extends { resetsAt: Date }>(window: T) {
  return { ...window, resetsAt: window.resetsAt.toISOString() };
}

/** Organization-wide mail counts over a window, from the outbound ledger, so
 * broadcasts and sequences count as well as transactional email. Each team
 * also gets its health and shared-mailbox quota. `sent` is what the ESP
 * accepted; `bounced` and `complained` are among those. Cancelled sends
 * aren't counted. */
export async function getOrganizationMailActivity(
  organizationId: string,
  rangeDays: MailActivityRangeDays,
) {
  const rangeStart = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const orgTeams = await db
    .select({
      id: teams.id,
      teamId: teams.teamId,
      name: teams.name,
      status: teams.status,
      externalId: teams.externalId,
    })
    .from(teams)
    .where(eq(teams.organizationId, organizationId))
    .orderBy(asc(teams.name));

  const mailByTeam = new Map<string, OrganizationMailCounts>();
  for (const team of orgTeams) mailByTeam.set(team.id, emptyCounts());

  const teamIds = orgTeams.map((team) => team.id);
  const [mailRows, health, quota] = await Promise.all([
    teamIds.length === 0
      ? []
      : db
          .select({
            teamId: outboundMessages.teamId,
            sent: count(outboundMessages.acceptedAt),
            queued: count(
              sql`CASE WHEN ${outboundMessages.deliveryStatus} IN ('queued', 'prepared') THEN 1 END`,
            ),
            failed: count(
              sql`CASE WHEN ${outboundMessages.deliveryStatus} = 'failed' THEN 1 END`,
            ),
            bounced: count(
              sql`CASE WHEN ${outboundMessages.deliveryStatus} = 'bounced' THEN 1 END`,
            ),
            complained: count(
              sql`CASE WHEN ${outboundMessages.feedbackStatus} = 'complained' THEN 1 END`,
            ),
          })
          .from(outboundMessages)
          .where(
            and(
              inArray(outboundMessages.teamId, teamIds),
              gt(outboundMessages.createdAt, rangeStart),
            ),
          )
          .groupBy(outboundMessages.teamId),
    getTeamsHealth(teamIds),
    getTeamsQuotaUsage(teamIds),
  ]);
  for (const row of mailRows) {
    const mail = mailByTeam.get(row.teamId);
    if (!mail) continue;
    for (const key of MAIL_COUNT_KEYS) mail[key] = Number(row[key]);
  }

  const teamRows = orgTeams.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    status: team.status as "active" | "sending_suspended" | "archived",
    externalId: team.externalId,
    mail: mailByTeam.get(team.id) ?? emptyCounts(),
    health: health.get(team.id)!,
    quota: (() => {
      const usage = quota.get(team.id);
      return usage ? { day: iso(usage.day), month: iso(usage.month) } : null;
    })(),
  }));

  const totals = emptyCounts();
  for (const row of teamRows) {
    for (const key of MAIL_COUNT_KEYS) totals[key] += row.mail[key];
  }

  return { rangeDays, totals, teams: teamRows };
}
