import logger from "../services/log";
import sequenceQueue from "../mail/sequence-queue";
import { getDueOngoingSequences } from "./queries";

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
            const due = await getDueOngoingSequences();
            for (const ongoingSequence of due) {
                try {
                    await sequenceQueue.add("sequence", {
                        ongoingSequenceId: ongoingSequence.id,
                    });
                } catch (err: any) {
                    logger.error(
                        { error: err.message, ongoing_sequence_id: ongoingSequence.id },
                        "processOngoingSequences enqueue failed",
                    );
                }
            }
        } catch (err: any) {
            logger.error({ error: err.message }, "processOngoingSequences loop failed");
        }

        await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
    }
}
