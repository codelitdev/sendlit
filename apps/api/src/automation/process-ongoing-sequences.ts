import logger from "../services/log";
import sequenceQueue from "../mail/sequence-queue";
import { getDueOngoingSequences } from "./queries";

/**
 * A single scheduler pass: enqueue every due `ongoing_sequences` row onto the
 * `sequence` BullMQ queue. Extracted from the polling loop so it can be tested.
 */
export async function enqueueDueOngoingSequences(): Promise<void> {
    const due = await getDueOngoingSequences();
    for (const ongoingSequence of due) {
        try {
            // jobId dedups against jobs already waiting/active, so a
            // row that stays due across polls (worker backlog) isn't
            // queued twice. See docs/automation-scale-review.md #1.
            await sequenceQueue.add(
                "sequence",
                { ongoingSequenceId: ongoingSequence.id },
                { jobId: ongoingSequence.id },
            );
        } catch (err: any) {
            logger.error(
                { error: err.message, ongoing_sequence_id: ongoingSequence.id },
                "processOngoingSequences enqueue failed",
            );
        }
    }
}

/**
 * Polls for `ongoing_sequences` rows whose `nextEmailScheduledTime` is due and
 * hands each one off to the `sequence` BullMQ queue (processed by
 * `mail/sequence-worker.ts` → `process-ongoing-sequence.ts`).
 */
export async function processOngoingSequences(): Promise<void> {
    if (!process.env.PIXEL_SIGNING_SECRET) {
        throw new Error("PIXEL_SIGNING_SECRET environment variable is not defined");
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await enqueueDueOngoingSequences();
        } catch (err: any) {
            logger.error({ error: err.message }, "processOngoingSequences loop failed");
        }

        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    }
}
