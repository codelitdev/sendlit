import { z } from "zod";

/** General (non-ESP) per-team workspace settings — a per-team singleton
 * (get/upsert, never a list), addressed via `/settings/general` like the ESP
 * settings, so no id fields are exposed. */
/** A physical postal address as separate fields. SendLit turns it into the
 * footer's `mailingAddress` text with `formatPostalAddress` from
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
  /** Physical postal address rendered in email footers
   * (CAN-SPAM/GDPR requirement). */
  mailingAddress: z.string().nullable(),
  /** The same address as separate fields, when it was saved that way;
   * `null` when it was saved as free text or isn't set. */
  postalAddress: postalAddressSchema.nullable(),
  updatedAt: z.string().nullable().optional(),
});

export const updateGeneralSettingsObjectSchema = z.object({
  /** Free-text address. Send an empty string to clear the address. Clears
   * `postalAddress`, since its fields no longer describe it. */
  mailingAddress: z.string().optional(),
  /** The address as separate fields; SendLit formats `mailingAddress` from
   * it. `null` clears the address. Can't be sent with `mailingAddress`. */
  postalAddress: postalAddressSchema.nullable().optional(),
});

export const GENERAL_SETTINGS_ADDRESS_CONFLICT =
  "Send either mailingAddress or postalAddress, not both";

export const updateGeneralSettingsBodySchema = updateGeneralSettingsObjectSchema.refine(
  (body) => body.mailingAddress === undefined || body.postalAddress === undefined,
  { message: GENERAL_SETTINGS_ADDRESS_CONFLICT, path: ["postalAddress"] },
);

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
