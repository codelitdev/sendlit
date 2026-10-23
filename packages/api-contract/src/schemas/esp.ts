import { z } from "zod";

export const espProviders = [
  "smtp",
  "sendgrid",
  "mailgun",
  "postmark",
  "ses",
  "resend",
] as const;

/**
 * Messages per second each provider accepts when an ESP doesn't set its own
 * `maxSendRate`. Amazon SES starts new accounts at 14/s (raise it to your
 * account's `MaxSendRate`); Resend allows 2 requests per second per team.
 * Providers without a published per-second cap aren't throttled by default.
 */
export const defaultMaxSendRates: Partial<
  Record<(typeof espProviders)[number], number>
> = {
  ses: 14,
  resend: 2,
};

/**
 * Automatic warm-up: the most marketing email a new ESP may send on each UTC
 * day of its warm-up (index 0 is the day it started), roughly doubling at
 * first, then growing 40% a day past the table. Mailbox providers trust a
 * sender whose volume grows gradually, and the first days' mail goes to the
 * most engaged contacts.
 */
export const WARMUP_RAMP = [
  50, 100, 200, 400, 750, 1_500, 3_000, 5_000, 8_000, 12_000, 18_000, 25_000, 35_000,
  50_000, 70_000, 100_000,
] as const;

/** The warm-up's limit on `day` (0-based), never above the target. */
export function warmupDailyLimit(day: number, targetDailyVolume: number): number {
  const ramp =
    day < WARMUP_RAMP.length
      ? WARMUP_RAMP[Math.max(0, day)]
      : Math.round(
          WARMUP_RAMP[WARMUP_RAMP.length - 1] * 1.4 ** (day - WARMUP_RAMP.length + 1),
        );
  return Math.min(ramp, targetDailyVolume);
}

/** Days until the ramp reaches the target, counting the first day as 1. */
export function warmupDays(targetDailyVolume: number): number {
  let day = 0;
  while (warmupDailyLimit(day, Number.POSITIVE_INFINITY) < targetDailyVolume) day++;
  return day + 1;
}

export const espWarmupSchema = z.object({
  targetDailyVolume: z.number().int(),
  startedAt: z.string(),
  /** Day of the warm-up, starting at 1. */
  day: z.number().int(),
  totalDays: z.number().int(),
  /** Most marketing email this ESP sends today because of the warm-up. */
  todayLimit: z.number().int(),
  complete: z.boolean(),
});

export type EspWarmup = z.infer<typeof espWarmupSchema>;

const warmupTargetSchema = z
  .number()
  .int()
  .min(100)
  .max(10_000_000)
  .nullable()
  .optional()
  .describe(
    "Turns on automatic warm-up up to this many marketing emails a day: the daily limit starts at 50 and grows each UTC day until it reaches the target, with the most engaged contacts sent to first. Setting it starts the warm-up from day 1 (changing the target of a running warm-up keeps its progress). `null` turns it off.",
  );

/** Public shape only — the encrypted password/secret is never returned to
 * clients, only a `hasPassword` boolean (see
 * `apps/api/src/settings/esp/routes.ts`'s `toPublicShape`). */
export const espConfigSchema = z.object({
  espId: z.string(),
  name: z.string(),
  // Plain string, not the enum — the DB column is unconstrained text and
  // validated on write (see `upsertEspConfigBodySchema`).
  provider: z.string(),
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  username: z.string().nullable().optional(),
  hasPassword: z.boolean(),
  fromName: z.string().nullable().optional(),
  fromEmail: z.string().nullable().optional(),
  replyTo: z.string().nullable().optional(),
  /** Configured messages per second; `null` means the provider default. */
  maxSendRate: z.number().nullable().optional(),
  /** Daily cap on marketing sends (UTC days); `null` means none. */
  dailySendLimit: z.number().int().nullable().optional(),
  /** Marketing sends today (UTC), when the ESP has a daily cap. */
  sentToday: z.number().int().nullable().optional(),
  /** Automatic warm-up, while one is set up. */
  warmup: espWarmupSchema.nullable().optional(),
  status: z.enum(["draft", "active", "suspended", "draining", "retired"]),
  secretVersion: z.number().int().positive(),
  lastTestedAt: z.string().nullable().optional(),
  lastTestStatus: z.enum(["success", "failed"]).nullable().optional(),
  lastTestError: z.string().nullable().optional(),
  activatedAt: z.string().nullable().optional(),
  drainUntil: z.string().nullable().optional(),
  retiredAt: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

const maxSendRateSchema = z
  .number()
  .positive()
  .max(10_000)
  .nullable()
  .optional()
  .describe(
    "Messages per second to send through this ESP, across all workers. `null` uses the provider default (Amazon SES 14, Resend 2, others unlimited).",
  );

const dailySendLimitSchema = z
  .number()
  .int()
  .positive()
  .nullable()
  .optional()
  .describe(
    "Most marketing emails (broadcasts and sequences) to send through this ESP per UTC day, e.g. while warming up a new domain. Emails over the cap wait for the next day. `null` removes the cap; transactional email is never capped.",
  );

export const upsertEspConfigBodySchema = z.object({
  provider: z.enum(espProviders),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().optional(),
  /** Omit to keep the existing secret unchanged; send `""` to clear it. */
  password: z.string().optional(),
  fromName: z.string().optional(),
  fromEmail: z.string().email().optional(),
  replyTo: z
    .union([z.string().email(), z.literal("")])
    .optional()
    .describe('Where replies go, when not the from address. `""` clears it.'),
  maxSendRate: maxSendRateSchema,
  dailySendLimit: dailySendLimitSchema,
  warmupTargetDailyVolume: warmupTargetSchema,
});

export const createEspConfigBodySchema = upsertEspConfigBodySchema.extend({
  name: z.string().trim().min(1).max(100),
});

export const updateEspConfigBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    provider: z.enum(espProviders).optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    fromName: z.string().optional(),
    fromEmail: z.union([z.string().email(), z.literal("")]).optional(),
    replyTo: z.union([z.string().email(), z.literal("")]).optional(),
    maxSendRate: maxSendRateSchema,
    dailySendLimit: dailySendLimitSchema,
    warmupTargetDailyVolume: warmupTargetSchema,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export const testEspConfigBodySchema = z.object({
  to: z.string().email().optional(),
});

export const testEspConfigResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

export const retireEspConfigBodySchema = z.discriminatedUnion("transition", [
  z.object({
    transition: z.literal("drain"),
    drainUntil: z.string().datetime().optional(),
  }),
  z.object({ transition: z.literal("cancel") }),
]);

export const domainAuthStatuses = ["pass", "warn", "fail"] as const;

const domainAuthCheckSchema = z.object({
  status: z.enum(domainAuthStatuses),
  message: z.string(),
  /** The DNS record SendLit found, if any. */
  record: z.string().nullable(),
});

/** SPF, DKIM and DMARC status of the domain an ESP sends from, with the
 * DNS records to add. */
export const domainAuthenticationSchema = z.object({
  domain: z.string(),
  provider: z.enum(espProviders),
  spf: domainAuthCheckSchema.extend({ host: z.string() }),
  dkim: domainAuthCheckSchema.extend({ selector: z.string().nullable() }),
  dmarc: domainAuthCheckSchema.extend({ policy: z.string().nullable() }),
  records: z.array(
    z.object({
      type: z.enum(["TXT", "CNAME", "MX"]),
      name: z.string(),
      /** `null` when only the provider's console knows the value. */
      value: z.string().nullable(),
      purpose: z.string(),
      present: z.boolean(),
    }),
  ),
  providerConsoleUrl: z.string().nullable(),
  checkedAt: z.string(),
});

export type DomainAuthentication = z.infer<typeof domainAuthenticationSchema>;

export const domainAuthenticationQuerySchema = z.object({
  dkimSelector: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,63}$/)
    .optional()
    .describe(
      "DKIM selector to check (for Amazon SES, one Easy DKIM token). A selector that passes is saved on the ESP and used by later checks that omit it.",
    ),
});
