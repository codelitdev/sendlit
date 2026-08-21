import { and, asc, count, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { teams, transactionalEmails } from "../db/schema";

export const MAIL_ACTIVITY_RANGE_DAYS = [1, 3, 7, 30] as const;
export type MailActivityRangeDays = (typeof MAIL_ACTIVITY_RANGE_DAYS)[number];

export type OrganizationMailCounts = {
    sent: number;
    queued: number;
    failed: number;
    bounced: number;
};

function emptyCounts(): OrganizationMailCounts {
    return { sent: 0, queued: 0, failed: 0, bounced: 0 };
}

/** Organization-wide transactional mail counts over a window. Maps
 * `transactional_emails.status` the same way as the team overview
 * (`sent`/`queued`/`failed`/`bounced` only; other statuses are ignored). */
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

    if (orgTeams.length > 0) {
        const mailRows = await db
            .select({
                teamId: transactionalEmails.teamId,
                status: transactionalEmails.status,
                value: count(),
            })
            .from(transactionalEmails)
            .where(
                and(
                    inArray(
                        transactionalEmails.teamId,
                        orgTeams.map((team) => team.id),
                    ),
                    gt(transactionalEmails.createdAt, rangeStart),
                ),
            )
            .groupBy(transactionalEmails.teamId, transactionalEmails.status);

        for (const row of mailRows) {
            const mail = mailByTeam.get(row.teamId);
            if (!mail) continue;
            if (row.status in mail) {
                mail[row.status as keyof OrganizationMailCounts] = Number(
                    row.value,
                );
            }
        }
    }

    const teamRows = orgTeams.map((team) => ({
        teamId: team.teamId,
        name: team.name,
        status: team.status as "active" | "sending_suspended" | "archived",
        externalId: team.externalId,
        mail: mailByTeam.get(team.id) ?? emptyCounts(),
    }));

    const totals = emptyCounts();
    for (const row of teamRows) {
        totals.sent += row.mail.sent;
        totals.queued += row.mail.queued;
        totals.failed += row.mail.failed;
        totals.bounced += row.mail.bounced;
    }

    return { rangeDays, totals, teams: teamRows };
}
