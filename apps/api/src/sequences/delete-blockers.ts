/**
 * Why a broadcast or sequence can't be deleted. Each code tells the caller
 * what to do instead, so the REST API, MCP and dashboard explain it the same
 * way.
 */
export const sequenceDeleteBlockerMessages = {
  // Contacts are moving through it (or a broadcast is sending), so deleting
  // it would drop them mid-flow. Pausing stops new sends first.
  sequence_active:
    "This sequence is active. Pause it before deleting it, so no contact is dropped mid-flow.",
  // A broadcast that has started sending keeps its report (#147): archive
  // it to hide it instead.
  broadcast_sent:
    "This broadcast has been sent, so deleting it would erase its report. Archive it instead: it leaves the list and the web archive, and its report is kept.",
} as const;

export type SequenceDeleteBlocker = keyof typeof sequenceDeleteBlockerMessages;

export function isSequenceDeleteBlocker(code: unknown): code is SequenceDeleteBlocker {
  return typeof code === "string" && Object.hasOwn(sequenceDeleteBlockerMessages, code);
}

/** The explanation for a delete blocker, or `undefined` for any other error. */
export function sequenceDeleteBlockerMessage(code: unknown): string | undefined {
  return isSequenceDeleteBlocker(code)
    ? sequenceDeleteBlockerMessages[code]
    : undefined;
}

interface BlockerInput {
  status: string;
  type?: string;
  report?: unknown;
  /** A broadcast's send time (epoch millis), `emails[0].delayInMillis`. */
  sendAt?: number | null;
}

/** Whether a broadcast has started sending: its audience is locked. */
export function broadcastStarted(report: unknown): boolean {
  return Boolean(
    (report as { broadcast?: { lockedAt?: number | null } } | null)?.broadcast
      ?.lockedAt,
  );
}

/**
 * The blocker for a sequence in this state, or `null` when it may be
 * deleted. Broadcasts: a draft or a scheduled one whose send time hasn't
 * come can be deleted; a sending one is `sequence_active`; once it has
 * started sending (sent, or paused mid-send) it is `broadcast_sent`.
 */
export function sequenceDeleteBlocker(
  sequence: BlockerInput,
  now = Date.now(),
): SequenceDeleteBlocker | null {
  if (sequence.type === "broadcast") {
    const started = broadcastStarted(sequence.report);
    if (sequence.status === "active") {
      const scheduled = !started && (sequence.sendAt ?? 0) > now;
      return scheduled ? null : "sequence_active";
    }
    return started ? "broadcast_sent" : null;
  }
  return sequence.status === "active" ? "sequence_active" : null;
}

export const broadcastArchiveErrors = {
  broadcast_not_sent:
    "Only a sent broadcast can be archived. Delete a draft or scheduled broadcast instead.",
  sequence_active: sequenceDeleteBlockerMessages.sequence_active,
} as const;

/** Why a broadcast can't be archived, or `null` when it can: archive is
 * for broadcasts that have sent mail and aren't sending now. */
export function broadcastArchiveBlocker(
  sequence: BlockerInput,
  now = Date.now(),
): keyof typeof broadcastArchiveErrors | null {
  const blocker = sequenceDeleteBlocker(sequence, now);
  if (blocker === "broadcast_sent") return null;
  if (blocker === "sequence_active") return "sequence_active";
  return "broadcast_not_sent";
}
