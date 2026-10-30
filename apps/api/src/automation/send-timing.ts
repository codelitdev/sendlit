/** Slack for clock differences between the API and worker processes. */
const TOLERANCE_MS = 60_000;

/**
 * How far ahead of its delay a sequence's first email is about to go out, or
 * null when it's on time (or late, which pauses and rate limits cause
 * routinely).
 *
 * Only the first email is checked: its delay counts from entry, which is
 * where scheduling went wrong before. Later emails are timed from the one
 * before, and reordering or deleting emails legitimately changes which one
 * comes next, so they have nothing reliable to compare against. For the same
 * reason it returns null when the email or the sequence changed after the
 * contact entered.
 */
export function sequenceSendEarlyByMs({
  enrolledAt,
  sentEmailIds,
  email,
  sequenceUpdatedAt,
  now = Date.now(),
}: {
  enrolledAt: Date | null;
  sentEmailIds: string[];
  email: { delayInMillis: number; updatedAt: Date | null };
  sequenceUpdatedAt: Date | null;
  now?: number;
}): number | null {
  if (!enrolledAt || sentEmailIds.length > 0) return null;
  const entered = enrolledAt.getTime();
  for (const changedAt of [email.updatedAt, sequenceUpdatedAt]) {
    if (changedAt && changedAt.getTime() > entered) return null;
  }
  const earlyBy = entered + email.delayInMillis - now;
  return earlyBy > TOLERANCE_MS ? earlyBy : null;
}
