import { and, eq, lte, or } from "drizzle-orm";
import { db } from "../db/client";
import { mailDispatchOutbox, outboundMessages } from "../db/schema";
import logger from "../services/log";
import { addTransactionalMailJob } from "./queue";

const LEASE_MS = 30_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

async function leaseOne() {
    return db.transaction(async (tx) => {
        const now = new Date();
        const [row] = await tx
            .select()
            .from(mailDispatchOutbox)
            .where(
                and(
                    lte(mailDispatchOutbox.availableAt, now),
                    or(
                        eq(mailDispatchOutbox.state, "pending"),
                        and(
                            eq(mailDispatchOutbox.state, "publishing"),
                            lte(mailDispatchOutbox.leaseExpiresAt, now),
                        ),
                    ),
                ),
            )
            .limit(1)
            .for("update", { skipLocked: true });
        if (!row) return null;
        const [leased] = await tx
            .update(mailDispatchOutbox)
            .set({
                state: "publishing",
                leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
                publishAttempts: row.publishAttempts + 1,
                updatedAt: now,
            })
            .where(eq(mailDispatchOutbox.id, row.id))
            .returning();
        return leased;
    });
}

export async function publishDueMailDispatches(limit = 100) {
    if (running) return;
    running = true;
    try {
        for (let i = 0; i < limit; i += 1) {
            const dispatch = await leaseOne();
            if (!dispatch) break;
            try {
                const [outbound] = await db
                    .select({
                        transactionalEmailId:
                            outboundMessages.transactionalEmailId,
                    })
                    .from(outboundMessages)
                    .where(eq(outboundMessages.id, dispatch.outboundMessageId))
                    .limit(1);
                if (
                    dispatch.jobName !== "transactional" ||
                    !outbound?.transactionalEmailId
                ) {
                    throw new Error("unsupported_dispatch_job");
                }
                await addTransactionalMailJob({
                    transactionalEmailId: outbound.transactionalEmailId,
                    dispatchId: dispatch.dispatchId,
                });
                await db
                    .update(mailDispatchOutbox)
                    .set({
                        state: "published",
                        publishedAt: new Date(),
                        leaseExpiresAt: null,
                        lastError: null,
                        updatedAt: new Date(),
                    })
                    .where(eq(mailDispatchOutbox.id, dispatch.id));
            } catch (error: any) {
                const delay = Math.min(
                    60_000,
                    1_000 * 2 ** Math.min(dispatch.publishAttempts, 6),
                );
                await db
                    .update(mailDispatchOutbox)
                    .set({
                        state: "pending",
                        availableAt: new Date(Date.now() + delay),
                        leaseExpiresAt: null,
                        lastError: String(error?.message ?? error).slice(
                            0,
                            500,
                        ),
                        updatedAt: new Date(),
                    })
                    .where(eq(mailDispatchOutbox.id, dispatch.id));
            }
        }
    } finally {
        running = false;
    }
}

export function startMailDispatchOutbox() {
    if (timer) return;
    void publishDueMailDispatches().catch((error) =>
        logger.error({ error }, "mail dispatch outbox poll failed"),
    );
    timer = setInterval(() => {
        void publishDueMailDispatches().catch((error) =>
            logger.error({ error }, "mail dispatch outbox poll failed"),
        );
    }, 1_000);
    timer.unref();
}

export function stopMailDispatchOutbox() {
    if (timer) clearInterval(timer);
    timer = null;
}
