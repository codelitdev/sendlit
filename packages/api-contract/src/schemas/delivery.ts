import { z } from "zod";

const nullableLimit = z.number().int().nonnegative().nullable();

export const organizationDeliveryPolicySchema = z.object({
  defaultEspId: z.string().nullable(),
  autoGrantDefaultEsp: z.boolean(),
  defaultDailyLimit: nullableLimit,
  defaultMonthlyLimit: nullableLimit,
  aggregateDailyLimit: nullableLimit,
  aggregateMonthlyLimit: nullableLimit,
  teamEspEnabledByDefault: z.boolean(),
  teamCanChangeDefault: z.boolean(),
  /** Whether teams on a shared ESP must send from their own verified
   * domain: `off` (default), for `marketing` only, or for `all` mail. */
  requireTeamSendingDomain: z.enum(["off", "marketing", "all"]),
  /** Monthly cap on each team's marketing through a shared ESP while it
   * still uses the shared From domain; `null` for none. */
  sharedDomainMonthlyLimit: nullableLimit,
  updatedAt: z.string(),
});

export const updateOrganizationDeliveryPolicyBodySchema = z
  .object({
    defaultEspId: z.string().nullable().optional(),
    autoGrantDefaultEsp: z.boolean().optional(),
    defaultDailyLimit: nullableLimit.optional(),
    defaultMonthlyLimit: nullableLimit.optional(),
    aggregateDailyLimit: nullableLimit.optional(),
    aggregateMonthlyLimit: nullableLimit.optional(),
    teamEspEnabledByDefault: z.boolean().optional(),
    teamCanChangeDefault: z.boolean().optional(),
    requireTeamSendingDomain: z.enum(["off", "marketing", "all"]).optional(),
    sharedDomainMonthlyLimit: nullableLimit.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const espGrantSchema = z.object({
  grantId: z.string(),
  teamId: z.string(),
  espId: z.string(),
  status: z.enum(["active", "draining", "suspended", "revoked"]),
  drainUntil: z.string().nullable(),
  fromName: z.string().nullable(),
  replyTo: z.string().nullable(),
  dailyLimit: nullableLimit,
  monthlyLimit: nullableLimit,
  /** The team's own From address on this mailbox, when it has one. */
  fromEmail: z.string().nullable(),
  /** The team's own sending domain, when it has one (see
   * `/teams/:teamId/sending-domain`). */
  sendingDomain: z
    .object({
      domain: z.string(),
      status: z.enum(["pending", "verified", "failing"]),
      inUse: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const upsertEspGrantBodySchema = z.object({
  espId: z.string(),
  fromName: z.string().nullable().optional(),
  replyTo: z.string().email().nullable().optional(),
  dailyLimit: nullableLimit.optional(),
  monthlyLimit: nullableLimit.optional(),
  /** Organization owners/integrations may select the newly granted shared
   * source as the team's default. This does not grant the team access to
   * the ESP credentials. */
  makeDefault: z.boolean().optional(),
});

export const transitionEspGrantBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("suspend") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("drain"),
    drainUntil: z.string().datetime().optional(),
  }),
  z.object({ action: z.literal("cancel") }),
]);

export const teamDeliverySettingsSchema = z.object({
  teamEspEnabled: z.boolean(),
  teamCanChangeDefault: z.boolean(),
  defaultSource: z.enum(["organization", "team"]).nullable(),
  defaultTeamEspId: z.string().nullable(),
  updatedAt: z.string(),
});

export const updateTeamDeliverySettingsBodySchema = z.object({
  deliverySource: z.discriminatedUnion("type", [
    z.object({ type: z.literal("organization") }),
    z.object({ type: z.literal("team"), espId: z.string() }),
  ]),
});

/** Public source selector used by drafts and immediate sends. Organization
 * topology remains intentionally opaque to team-authorized callers. */
export const deliverySourceSelectionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("organization") }),
  z.object({
    type: z.literal("team"),
    espId: z.string().min(1).optional(),
  }),
]);

export const sendingOptionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("organization"),
    name: z.string(),
    fromName: z.string().nullable(),
    fromEmail: z.string().nullable(),
    replyTo: z.string().nullable(),
    isDefault: z.boolean(),
    available: z.boolean(),
    countsAgainstQuota: z.literal(true),
  }),
  z.object({
    type: z.literal("team"),
    espId: z.string(),
    name: z.string(),
    fromName: z.string().nullable(),
    fromEmail: z.string().nullable(),
    isDefault: z.boolean(),
    available: z.boolean(),
    countsAgainstQuota: z.literal(false),
  }),
]);

export const teamSendingDomainRecordSchema = z.object({
  type: z.enum(["CNAME", "TXT"]),
  name: z.string(),
  value: z.string(),
  purpose: z.enum(["dkim", "dmarc"]),
  /** Whether the last check found it in place. */
  present: z.boolean().optional(),
});

/** A team's own From domain on its organization's shared ESP. */
export const teamSendingDomainSchema = z.object({
  domain: z.string(),
  fromEmail: z.string().nullable(),
  /** `pending` until DKIM and DMARC first pass, `verified` once they have,
   * `failing` when they stopped passing after that. */
  status: z.enum(["pending", "verified", "failing"]),
  dkim: z.enum(["pending", "verified", "failed"]),
  dmarc: z.enum(["pass", "missing"]),
  /** Whether the team's mail goes out from this domain right now. */
  inUse: z.boolean(),
  records: z.array(teamSendingDomainRecordSchema),
  verifiedAt: z.string().nullable(),
  failingSince: z.string().nullable(),
  /** When the team's marketing pauses if the domain keeps failing. */
  graceEndsAt: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
});

export const setTeamSendingDomainBodySchema = z.object({
  /** The team's From address; its domain is registered with the shared ESP. */
  fromEmail: z.string().email(),
});
