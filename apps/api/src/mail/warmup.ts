import {
  type espWarmupSchema,
  warmupDailyLimit,
  warmupDays,
} from "@sendlit/api-contract";
import type { z } from "zod";

type WarmupFields = {
  warmupTargetDaily: number | null;
  warmupStartedAt: Date | null;
  dailySendLimit: number | null;
};

const DAY_MS = 86_400_000;
const utcDay = (date: Date) => Math.floor(date.getTime() / DAY_MS);

/** Where an ESP's automatic warm-up stands today, or `null` when it has
 * none. Days are UTC days, like the daily send limit. */
export function warmupState(
  esp: WarmupFields,
  now = new Date(),
): z.infer<typeof espWarmupSchema> | null {
  if (!esp.warmupTargetDaily || !esp.warmupStartedAt) return null;
  const day = Math.max(0, utcDay(now) - utcDay(esp.warmupStartedAt));
  const todayLimit = warmupDailyLimit(day, esp.warmupTargetDaily);
  return {
    targetDailyVolume: esp.warmupTargetDaily,
    startedAt: esp.warmupStartedAt.toISOString(),
    day: day + 1,
    totalDays: warmupDays(esp.warmupTargetDaily),
    todayLimit,
    complete: todayLimit >= esp.warmupTargetDaily,
  };
}

/** Today's cap on marketing sends: the ESP's own daily limit and, while a
 * warm-up runs, the warm-up's limit for the day, whichever is lower. */
export function effectiveDailySendLimit(
  esp: WarmupFields,
  now = new Date(),
): number | null {
  const warmup = warmupState(esp, now);
  const limits = [
    esp.dailySendLimit,
    warmup && !warmup.complete ? warmup.todayLimit : null,
  ];
  const set = limits.filter((limit): limit is number => limit !== null);
  return set.length ? Math.min(...set) : null;
}

/** DB values for a `warmupTargetDailyVolume` input: `null` turns warm-up off,
 * a number starts one (or retargets a running one). */
export function warmupValues(
  input: number | null | undefined,
  existing: { warmupTargetDaily: number | null; warmupStartedAt: Date | null } | null,
):
  | { warmupTargetDaily: number | null; warmupStartedAt: Date | null }
  | Record<string, never> {
  if (input === undefined) return {};
  if (input === null) return { warmupTargetDaily: null, warmupStartedAt: null };
  return {
    warmupTargetDaily: input,
    warmupStartedAt: existing?.warmupTargetDaily
      ? existing.warmupStartedAt
      : new Date(),
  };
}
