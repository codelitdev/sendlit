import { z } from "zod";

/** A team's physical postal address (CAN-SPAM/GDPR) as separate fields. The
 * email footer shows it as text formatted with `formatPostalAddress` from
 * `@sendlit/email-blocks/postal-address`. */
export const postalAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200).describe("Street address"),
  line2: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Apartment, suite, building and so on"),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional().describe("State, province or region"),
  postalCode: z.string().trim().max(20).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .describe("ISO 3166-1 alpha-2 country code, uppercase (for example `GB`)"),
});

export type PostalAddress = z.infer<typeof postalAddressSchema>;

/** General (non-ESP) per-team workspace settings — a per-team singleton
 * (get/upsert, never a list), addressed via `/settings/general` like the ESP
 * settings, so no id fields are exposed. */
export const generalSettingsSchema = z.object({
  /** The physical postal address shown in marketing email footers; required
   * for broadcasts and sequences. `null` until it is set. */
  postalAddress: postalAddressSchema.nullable(),
  updatedAt: z.string().nullable().optional(),
});

export const updateGeneralSettingsBodySchema = z.object({
  /** Omit to keep the address; `null` clears it. */
  postalAddress: postalAddressSchema.nullable().optional(),
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
