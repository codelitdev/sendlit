import { z } from "zod";

export const reputationProviders = ["google_postmaster", "microsoft_snds"] as const;

const connectionSchema = z.object({
  status: z.enum(["active", "error"]),
  /** e.g. the Google account that connected Postmaster Tools. */
  accountLabel: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  connectedAt: z.string(),
});

/** Google Postmaster Tools v2 daily numbers for a sending domain. Rates are
 * fractions (0.003 = 0.3%); `null` when Google has no data for the day. */
export const googleDaySchema = z.object({
  day: z.string(),
  spamRate: z.number().nullable(),
  spfRate: z.number().nullable(),
  dkimRate: z.number().nullable(),
  dmarcRate: z.number().nullable(),
  deliveryErrorRate: z.number().nullable(),
});

export const sndsDaySchema = z.object({
  day: z.string(),
  /** Outlook's spam filter verdict for the IP's mail. */
  filterResult: z.enum(["green", "yellow", "red"]).nullable(),
  /** Complaints per recipient; `null` when SNDS reports "< 0.1%". */
  complaintRate: z.number().nullable(),
  complaintRateText: z.string().nullable(),
  trapHits: z.number().int().nullable(),
  recipients: z.number().int().nullable(),
});

export const reputationAlertSchema = z.object({
  provider: z.enum(reputationProviders),
  /** The domain or IP. */
  subject: z.string(),
  signal: z.enum(["spam_rate", "compliance", "snds_filter"]),
  level: z.enum(["warning", "critical"]),
  message: z.string(),
});

export const reputationSchema = z.object({
  google: z.object({
    /** Whether this SendLit deployment has a Google OAuth client set up. */
    available: z.boolean(),
    connection: connectionSchema.nullable(),
    domains: z.array(
      z.object({
        domain: z.string(),
        /** `not_in_postmaster`: verify the domain in Postmaster Tools with the
         * connected Google account. */
        status: z.enum(["ok", "not_in_postmaster", "pending"]),
        /** Google's verdict on its bulk-sender requirements. */
        compliance: z
          .object({
            status: z.enum(["compliant", "needs_work", "unknown"]),
            needsWork: z.array(z.string()),
          })
          .nullable(),
        days: z.array(googleDaySchema),
      }),
    ),
  }),
  snds: z.object({
    connection: connectionSchema.nullable(),
    ips: z.array(z.object({ ip: z.string(), days: z.array(sndsDaySchema) })),
  }),
  alerts: z.array(reputationAlertSchema),
});
export type Reputation = z.infer<typeof reputationSchema>;

export const connectSndsBodySchema = z.object({
  dataUrl: z
    .string()
    .url()
    .describe(
      "The SNDS automated data access link (Automated Data Access page in SNDS). It expires after 30 days; paste the new one when it does.",
    ),
});
