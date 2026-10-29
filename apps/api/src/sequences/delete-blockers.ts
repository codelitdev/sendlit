/**
 * Why a broadcast or sequence can't be deleted. Each code tells the caller
 * what to do instead, so the REST API, MCP and dashboard explain it the same
 * way. Broadcast-only blockers (#147) belong here too.
 */
export const sequenceDeleteBlockerMessages = {
  // Contacts are moving through it (or a broadcast is sending), so deleting
  // it would drop them mid-flow. Pausing stops new sends first.
  sequence_active:
    "This sequence is active. Pause it before deleting it, so no contact is dropped mid-flow.",
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

/** The blocker for a sequence in this state, or `null` when it may be deleted. */
export function sequenceDeleteBlocker(sequence: {
  status: string;
}): SequenceDeleteBlocker | null {
  return sequence.status === "active" ? "sequence_active" : null;
}
