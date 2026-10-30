/** Slack for clock differences between the API and worker processes. */
const TOLERANCE_MS = 60_000;

/**
 * How far ahead of its schedule a sequence email is about to go out, or null
 * when it's on time (or late, which pauses and rate limits cause routinely).
 *
 * An email can't go out before the contact entered plus the delays of every
 * email sent so far and this one. When an email involved changed after the
 * contact entered (its delay lengthened, say, which correctly doesn't move
 * the stored schedule) or no longer exists, there is nothing reliable to
 * compare against, so it returns null.
 */
export function sequenceSendEarlyByMs({
  enrolledAt,
  sentEmailIds,
  email,
  emails,
  now = Date.now(),
}: {
  enrolledAt: Date | null;
  sentEmailIds: string[];
  email: SendTimingEmail;
  emails: SendTimingEmail[];
  now?: number;
}): number | null {
  if (!enrolledAt) return null;
  const steps = [
    ...sentEmailIds.map((id) => emails.find((e) => e.emailId === id)),
    email,
  ];
  let earliest = enrolledAt.getTime();
  for (const step of steps) {
    if (!step) return null;
    if (step.updatedAt && step.updatedAt.getTime() > enrolledAt.getTime()) return null;
    earliest += step.delayInMillis;
  }
  const earlyBy = earliest - now;
  return earlyBy > TOLERANCE_MS ? earlyBy : null;
}

type SendTimingEmail = {
  emailId: string;
  delayInMillis: number;
  updatedAt: Date | null;
};
