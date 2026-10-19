import { readAbuseConfig } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PacingBudget = { dailyLimit: number; hourlyLimit: number };

/**
 * How fast a hosted organization may send marketing mail while it is new
 * (#73): its daily allowance (the marketing ramp's, or its monthly cap spread
 * over 30 days once the ramp is over) split across `PACING_HOURS`, so a
 * broadcast goes out over the day instead of in one burst. Null when the
 * organization is old enough, exempted by an operator, or uncapped.
 */
export function pacingBudget(input: {
  organizationCreatedAt: Date;
  pacingExempt: boolean;
  rampDailyLimit: number | null;
  monthlySendsLimit: number | null;
  now?: Date;
}): PacingBudget | null {
  const config = readAbuseConfig();
  const now = input.now ?? new Date();
  if (input.pacingExempt) return null;
  const ageDays = (now.getTime() - input.organizationCreatedAt.getTime()) / DAY_MS;
  if (ageDays >= config.newAccountDays) return null;
  const dailyLimit =
    input.rampDailyLimit ??
    (input.monthlySendsLimit !== null ? Math.ceil(input.monthlySendsLimit / 30) : null);
  if (dailyLimit === null) return null;
  return {
    dailyLimit,
    hourlyLimit: Math.max(1, Math.ceil(dailyLimit / config.pacingHours)),
  };
}

/** When `remaining` more emails will have gone out at this pace. */
export function pacedCompletionEstimate(
  remaining: number,
  budget: PacingBudget,
  now = new Date(),
): Date {
  const config = readAbuseConfig();
  const fullDays = Math.floor(remaining / budget.dailyLimit);
  const rest = remaining % budget.dailyLimit;
  const hours = Math.min(Math.ceil(rest / budget.hourlyLimit), config.pacingHours);
  return new Date(now.getTime() + fullDays * DAY_MS + hours * 60 * 60 * 1000);
}

/** Milliseconds until the next UTC hour, plus up to 5 minutes of jitter. */
export function untilNextUtcHour(now = new Date()): number {
  const next = new Date(now);
  next.setUTCMinutes(60, 0, 0);
  return next.getTime() - now.getTime() + Math.floor(Math.random() * 300_000);
}
