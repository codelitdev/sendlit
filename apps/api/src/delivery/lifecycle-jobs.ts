import { and, eq, lte } from "drizzle-orm";
import { db } from "../db/client";
import { espConfigTeamGrants, espConfigs } from "../db/schema";
import { transitionEspConfig } from "../settings/esp/queries";
import { transitionEspGrant } from "./queries";
import logger from "../services/log";

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Enforces a requested drain deadline even when no later administrator call
 * arrives. Worker-side pin validation independently fails closed at the same
 * timestamp, so this job is cleanup rather than the primary safety boundary. */
export async function finalizeExpiredDeliveryDrains() {
    if (running) return;
    running = true;
    try {
        const now = new Date();
        const grants = await db
            .select({
                organizationId: espConfigTeamGrants.organizationId,
                teamId: espConfigTeamGrants.teamId,
            })
            .from(espConfigTeamGrants)
            .where(
                and(
                    eq(espConfigTeamGrants.status, "draining"),
                    lte(espConfigTeamGrants.drainUntil, now),
                ),
            );
        for (const grant of grants) {
            await transitionEspGrant(
                grant.organizationId,
                grant.teamId,
                "cancel",
            );
        }

        const configs = await db
            .select()
            .from(espConfigs)
            .where(
                and(
                    eq(espConfigs.status, "draining"),
                    lte(espConfigs.drainUntil, now),
                ),
            );
        for (const config of configs) {
            await transitionEspConfig(config, "retire", { cancel: true });
        }
    } finally {
        running = false;
    }
}

export function startDeliveryLifecycleJobs() {
    if (timer) return;
    void finalizeExpiredDeliveryDrains().catch((error) =>
        logger.error({ error }, "delivery drain finalization failed"),
    );
    timer = setInterval(() => {
        void finalizeExpiredDeliveryDrains().catch((error) =>
            logger.error({ error }, "delivery drain finalization failed"),
        );
    }, 60_000);
    timer.unref();
}

export function stopDeliveryLifecycleJobs() {
    if (timer) clearInterval(timer);
    timer = null;
}
