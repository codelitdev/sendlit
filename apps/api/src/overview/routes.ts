import { Router } from "express";
import { and, count, eq, gt } from "drizzle-orm";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { db } from "../db/client";
import {
    accounts,
    ongoingSequences,
    sequenceEmails,
    sequences,
    teams,
    transactionalEmails,
} from "../db/schema";

const router = Router();
router.use(requireAuth);
router.use(requireTeam);
const s = initServer();

createExpressEndpoints(
    contract.overview,
    s.router(contract.overview, {
        get: async ({ req }) => {
            const teamId = (req as any).teamId as string;
            const [active, ongoing, scheduled, mailRows, accountRow] =
                await Promise.all([
                    db
                        .select({ value: count() })
                        .from(sequences)
                        .where(
                            and(
                                eq(sequences.teamId, teamId),
                                eq(sequences.type, "sequence"),
                                eq(sequences.status, "active"),
                            ),
                        ),
                    db
                        .select({ value: count() })
                        .from(ongoingSequences)
                        .innerJoin(
                            sequences,
                            eq(ongoingSequences.sequenceId, sequences.id),
                        )
                        .where(eq(sequences.teamId, teamId)),
                    db
                        .select({ value: count() })
                        .from(sequences)
                        .innerJoin(
                            sequenceEmails,
                            eq(sequenceEmails.sequenceId, sequences.id),
                        )
                        .where(
                            and(
                                eq(sequences.teamId, teamId),
                                eq(sequences.type, "broadcast"),
                                eq(sequences.status, "active"),
                                gt(sequenceEmails.delayInMillis, Date.now()),
                            ),
                        ),
                    db
                        .select({
                            status: transactionalEmails.status,
                            value: count(),
                        })
                        .from(transactionalEmails)
                        .where(eq(transactionalEmails.teamId, teamId))
                        .groupBy(transactionalEmails.status),
                    db
                        .select({
                            dailyUsed: accounts.dailyMailCount,
                            dailyLimit: accounts.dailyMailLimit,
                            monthlyUsed: accounts.monthlyMailCount,
                            monthlyLimit: accounts.monthlyMailLimit,
                        })
                        .from(teams)
                        .innerJoin(
                            accounts,
                            eq(teams.ownerAccountId, accounts.id),
                        )
                        .where(eq(teams.id, teamId))
                        .limit(1),
                ]);
            const mail = { sent: 0, queued: 0, failed: 0, bounced: 0 };
            for (const row of mailRows)
                if (row.status in mail)
                    mail[row.status as keyof typeof mail] = row.value;
            const scheduledBroadcasts = scheduled[0]?.value ?? 0;
            mail.queued += scheduledBroadcasts;
            return {
                status: 200,
                body: {
                    activeSequences: active[0]?.value ?? 0,
                    ongoingContacts: ongoing[0]?.value ?? 0,
                    scheduledBroadcasts,
                    mail,
                    quota: accountRow[0] ?? {
                        dailyUsed: 0,
                        dailyLimit: 0,
                        monthlyUsed: 0,
                        monthlyLimit: 0,
                    },
                },
            };
        },
    }),
    router,
);
export default router;
