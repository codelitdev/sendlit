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
