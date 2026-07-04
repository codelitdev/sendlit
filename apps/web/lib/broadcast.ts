import type { Sequence } from "@sendlit/email-blocks";

/**
 * Broadcasts reuse the sequence state machine (draft/active/paused/completed)
 * but are presented with send-centric wording, mirroring CourseLit's
 * broadcast UI: an `active` broadcast whose send time hasn't arrived is
 * "scheduled" (cancellable), one past its send time or locked is "sending",
 * and `completed` is "sent". A `paused` broadcast is a cancelled schedule,
 * which is just a draft again. For broadcasts, `emails[0].delayInMillis`
 * holds the absolute send time in epoch millis (0 / past = send now).
 */
export function presentBroadcastStatus(sequence: Sequence): {
    label: "draft" | "scheduled" | "sending" | "sent";
    variant: "success" | "secondary" | "outline";
} {
    if (sequence.status === "completed") {
        return { label: "sent", variant: "outline" };
    }
    if (sequence.status === "active") {
        return broadcastScheduledFor(sequence)
            ? { label: "scheduled", variant: "success" }
            : { label: "sending", variant: "success" };
    }
    return { label: "draft", variant: "secondary" };
}

/** The future send time of an active, not-yet-locked broadcast, or `null`
 * if it isn't in a cancellable scheduled state. */
export function broadcastScheduledFor(sequence: Sequence): Date | null {
    if (sequence.status !== "active") return null;
    if (sequence.report?.broadcast?.lockedAt) return null;
    const sendAt = sequence.emails[0]?.delayInMillis ?? 0;
    return sendAt > Date.now() ? new Date(sendAt) : null;
}
