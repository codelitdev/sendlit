import logger from "../services/log";
import { captureError, captureEvent } from "../observability/posthog";
import {
    deleteRule,
    enrollContactsInOngoingSequence,
    getDueDateRules,
    getMatchingContactIds,
    getMatchingPublicContactIds,
    getSequenceRowById,
    lockBroadcast,
} from "./queries";
import type { ContactFilterWithAggregator } from "../contacts/segment";

/**
 * Ported from `courselit/apps/queue/src/domain/process-rules.ts`. Only handles
 * `DATE_OCCURRED` rules (used to schedule broadcasts). Tag/subscriber based
 * triggers are handled immediately by `automation/fire-event.ts` instead of
 * being polled here.
 */
export async function processRules() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await processDueRulesOnce();
        } catch (err: any) {
            logger.error({ error: err.message }, "processRules.loop failed");
            captureError({
                error: err,
                source: "automation.process_rules.loop",
                severity: "critical",
            });
        }

        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    }
}

/** One scheduler pass, extracted so recovery and per-rule isolation are
 * executable without entering the perpetual production polling loop. */
export async function processDueRulesOnce(): Promise<void> {
    const dueRules = await getDueDateRules();
    for (const rule of dueRules) {
        try {
            await processRule(rule);
        } catch (err: any) {
            logger.error(
                { error: err.message, sequence_id: rule.sequenceId },
                "processRules.rule failed",
            );
            captureError({
                error: err,
                source: "automation.process_rules.rule",
                teamId: rule.teamId,
                context: { sequence_id: rule.sequenceId },
            });
        }
    }
}

export async function processRule(rule: {
    ruleId: string;
    teamId: string;
    sequenceId: string;
}) {
    // sequenceId on a rule is now the internal sequences.id; find its row.
    const sequenceRow = await getSequenceRowById(rule.sequenceId);
    if (!sequenceRow) {
        await deleteRule(rule.ruleId);
        return;
    }

    const contactIds = await getMatchingContactIds(
        rule.teamId,
        sequenceRow.filter as ContactFilterWithAggregator | null,
    );

    logger.info(
        { sequence_id: sequenceRow.sequenceId, recipients: contactIds.length },
        "Enrolling contacts into broadcast",
    );

    await enrollContactsInOngoingSequence({
        teamId: rule.teamId,
        sequenceId: sequenceRow.id,
        contactIds,
    });

    captureEvent({
        event: "broadcast_recipients_enrolled",
        source: "automation.process_rules",
        teamId: rule.teamId,
        properties: {
            sequence_id: sequenceRow.sequenceId,
            recipients_count: contactIds.length,
        },
    });

    const publicContactIds = await getMatchingPublicContactIds(
        rule.teamId,
        sequenceRow.filter as ContactFilterWithAggregator | null,
    );
    await lockBroadcast(sequenceRow.id, publicContactIds);
    await deleteRule(rule.ruleId);
}
