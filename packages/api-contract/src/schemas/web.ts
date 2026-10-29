import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Must be an http(s) URL");

export const webSlugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes");

export const webHandleSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes");

/** How a broadcast is published as a public web page. */
export const webPublishingSchema = z.object({
  published: z.boolean(),
  slug: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  ogImage: z.string().nullable(),
  noindex: z.boolean(),
  canonicalUrl: z.string().nullable(),
  /** Published, already sent and not archived, so the page is public. */
  live: z.boolean(),
  /** When the issue was sent; `null` until then. */
  publishedAt: z.string().nullable(),
  /** The SendLit-hosted page; `null` while hosted pages are off. */
  url: z.string().nullable(),
});
export type WebPublishing = z.infer<typeof webPublishingSchema>;

export const updateWebPublishingBodySchema = z.object({
  published: z
    .boolean()
    .optional()
    .describe("Publish the broadcast as a public web page once it's sent"),
  slug: webSlugSchema
    .optional()
    .describe("URL slug; defaults to one made from the title"),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(500).nullable().optional(),
  ogImage: httpUrl.nullable().optional().describe("Image for social previews"),
  noindex: z.boolean().optional().describe("Ask search engines not to index the page"),
  canonicalUrl: httpUrl
    .nullable()
    .optional()
    .describe("Canonical URL, when a platform hosts the issue on its own site"),
});

/** The team's hosted web archive. */
export const webSettingsSchema = z.object({
  enabled: z.boolean(),
  handle: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** Signup form shown on the archive page. */
  signupFormId: z.string().nullable(),
  archiveUrl: z.string().nullable(),
  rssUrl: z.string().nullable(),
});
export type WebSettings = z.infer<typeof webSettingsSchema>;

export const updateWebSettingsBodySchema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe(
      "Host the archive and issue pages on SendLit; off when a platform renders them",
    ),
  handle: webHandleSchema.optional().describe("Archive URL: /w/<handle>"),
  title: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  signupFormId: z.string().nullable().optional(),
});

export const webIssueSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  publishedAt: z.string(),
  excerpt: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  ogImage: z.string().nullable(),
  noindex: z.boolean(),
  canonicalUrl: z.string().nullable(),
  url: z.string().nullable(),
});

/** A published issue with its HTML, stripped of anything personal or
 * tracked. */
export const webIssueSchema = webIssueSummarySchema.extend({
  html: z.string(),
});
export type WebIssue = z.infer<typeof webIssueSchema>;

export const listWebIssuesQuerySchema = z.object({
  offset: z.coerce.number().int().min(1).optional(),
  itemsPerPage: z.coerce.number().int().min(1).max(50).optional(),
});
