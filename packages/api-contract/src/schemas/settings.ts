import { z } from "zod";

/** General (non-ESP) per-team workspace settings — a per-team singleton
 * (get/upsert, never a list), addressed via `/settings/general` like the ESP
 * settings, so no id fields are exposed. */
export const generalSettingsSchema = z.object({
  /** Physical postal address rendered in email footers
   * (CAN-SPAM/GDPR requirement). */
  mailingAddress: z.string().nullable(),
  updatedAt: z.string().nullable().optional(),
});

export const updateGeneralSettingsBodySchema = z.object({
  /** Send an empty string to clear the mailing address. */
  mailingAddress: z.string().optional(),
});

export const trackingDomainStatuses = ["pending", "verified", "failed"] as const;

/** The team's custom tracking domain (open, click, unsubscribe and "view in
 * browser" links). */
export const trackingDomainSchema = z.object({
  domain: z.string().nullable(),
  /** `pending` until the CNAME and HTTPS work; `failed` after the domain
   * stopped working, when links fall back to SendLit's own host. */
  status: z.enum(trackingDomainStatuses).nullable(),
  /** The host the domain's CNAME record must point to. */
  cnameTarget: z.string(),
  /** Why the last check failed: `cname_missing`, `cname_mismatch`,
   * `unreachable` (no HTTPS answer yet) or `dns_error`. */
  error: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  checkedAt: z.string().nullable(),
});

export const updateTrackingDomainBodySchema = z.object({
  /** A subdomain such as `track.example.com`; `null` removes it. */
  domain: z.string().max(253).nullable(),
});

export type TrackingDomain = z.infer<typeof trackingDomainSchema>;
