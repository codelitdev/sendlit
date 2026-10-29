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
  label: "draft" | "scheduled" | "sending" | "paused" | "sent";
  variant: "success" | "warning" | "neutral";
} {
  if (sequence.status === "completed") {
    return { label: "sent", variant: "success" };
  }
  if (sequence.status === "active") {
    return broadcastScheduledFor(sequence)
      ? { label: "scheduled", variant: "warning" }
      : { label: "sending", variant: "success" };
  }
  // Paused mid-send (#25); a cancelled schedule is a draft again.
  if (sequence.status === "paused" && sequence.report?.broadcast?.lockedAt) {
    return { label: "paused", variant: "warning" };
  }
  return { label: "draft", variant: "neutral" };
}

/** The future send time of an active, not-yet-locked broadcast, or `null`
 * if it isn't in a cancellable scheduled state. */
export function broadcastScheduledFor(sequence: Sequence): Date | null {
  if (sequence.status !== "active") return null;
  if (sequence.report?.broadcast?.lockedAt) return null;
  const sendAt = sequence.emails[0]?.delayInMillis ?? 0;
  return sendAt > Date.now() ? new Date(sendAt) : null;
}

export interface BroadcastActionState {
  allowed: boolean;
  /** Why it isn't allowed, shown next to the disabled action. */
  reason?: string;
}

/**
 * Which of delete and archive a broadcast allows now, mirroring the API's
 * blockers (`apps/api/src/sequences/delete-blockers.ts`): drafts and
 * scheduled broadcasts can be deleted, a sending one neither, and one that
 * has started sending can only be archived.
 */
export function broadcastDeleteActions(sequence: Sequence): {
  delete: BroadcastActionState;
  archive: BroadcastActionState;
} {
  const started = Boolean(sequence.report?.broadcast?.lockedAt);
  if (sequence.status === "active" && !broadcastScheduledFor(sequence)) {
    const reason = "It's sending. Pause it first.";
    return { delete: { allowed: false, reason }, archive: { allowed: false, reason } };
  }
  if (started) {
    return {
      delete: {
        allowed: false,
        reason: "Sent broadcasts are archived, not deleted, to keep their report.",
      },
      archive: { allowed: true },
    };
  }
  return {
    delete: { allowed: true },
    archive: {
      allowed: false,
      reason: "Only sent broadcasts can be archived.",
    },
  };
}
