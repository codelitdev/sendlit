import { Router } from "express";
import { and, count, eq, gt, lt } from "drizzle-orm";
import { createExpressEndpoints, initServer } from "@ts-rest/express";
import { contract } from "@sendlit/api-contract";
import { requireAuth } from "../auth/middleware";
import { requireTeam } from "../auth/require-team";
import { db } from "../db/client";
import {
    ongoingSequences,
    sequenceEmails,
    sequences,
    transactionalEmails,
} from "../db/schema";

const router = Router();
router.use("/overview", requireAuth, requireTeam);
const s = initServer();

createExpressEndpoints(
    contract.overview,
    s.router(contract.overview, {
        get: async ({ req, query }) => {
            const teamId = (req as any).teamId as string;
            const rangeDays = query.rangeDays ?? 7;
            const rangeStart = new Date(
                Date.now() - rangeDays * 24 * 60 * 60 * 1000,
            );
            const rangeEnd = Date.now() + rangeDays * 24 * 60 * 60 * 1000;
            const [active, ongoing, scheduled, mailRows] = await Promise.all([
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
                            lt(sequenceEmails.delayInMillis, rangeEnd),
                        ),
                    ),
                db
                    .select({
                        status: transactionalEmails.status,
                        value: count(),
                    })
                    .from(transactionalEmails)
                    .where(
                        and(
                            eq(transactionalEmails.teamId, teamId),
                            gt(transactionalEmails.createdAt, rangeStart),
                        ),
                    )
                    .groupBy(transactionalEmails.status),
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
                    quota: {
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
