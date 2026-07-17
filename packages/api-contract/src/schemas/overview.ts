import { z } from "zod";

export const overviewSchema = z.object({
    activeSequences: z.number(),
    ongoingContacts: z.number(),
    scheduledBroadcasts: z.number(),
    mail: z.object({
        sent: z.number(),
        queued: z.number(),
        failed: z.number(),
        bounced: z.number(),
    }),
    quota: z.object({
        dailyUsed: z.number(),
        dailyLimit: z.number(),
        monthlyUsed: z.number(),
        monthlyLimit: z.number(),
    }),
});
