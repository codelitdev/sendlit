import { z } from "zod";
import { customFieldsSchema } from "./custom-fields";
import { contactFilterSchema } from "./sequences";

export function parseContactFilterQueryParam(value: string) {
  try {
    return contactFilterSchema.safeParse(JSON.parse(value));
  } catch {
    return { success: false } as const;
  }
}

export const contactSchema = z.object({
  contactId: z.string(),
  email: z.string(),
  name: z.string().nullable().optional(),
  subscribed: z.boolean(),
  customFields: customFieldsSchema,
  tags: z.array(z.string()),
  unsubscribeToken: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const createContactBodySchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: customFieldsSchema.optional(),
});

export const updateContactBodySchema = z.object({
  name: z.string().optional(),
  subscribed: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  customFields: customFieldsSchema.optional(),
});

export const listContactsQuerySchema = z.object({
  q: z.string().optional().describe("Search term matched against email or name"),
  segmentId: z
    .string()
    .optional()
    .describe(
      "Only return contacts matching this saved segment's filter; combines with q using AND",
    ),
  filter: z
    .string()
    .optional()
    .describe(
      "Serialized ContactFilterWithAggregator JSON; combines with q and segmentId using AND",
    ),
  excludeFilter: z
    .string()
    .optional()
    .describe(
      "Serialized ContactFilterWithAggregator JSON; contacts matching it are left out",
    ),
  offset: z.coerce.number().int().min(1).optional(),
  rowsPerPage: z.coerce.number().int().min(1).optional(),
});

export const contactDeliverySchema = z.object({
  sequenceId: z.string(),
  sequenceTitle: z.string(),
  sequenceType: z.string(),
  emailId: z.string(),
  createdAt: z.string().nullable(),
});

export const importContactRowSchema = z.object({
  /** Validated per row; an invalid address is reported as skipped. */
  email: z.string(),
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z
    .string()
    .optional()
    .describe(
      "The source platform's status, e.g. beehiiv's Active/Paused/Inactive/Pending or Mailchimp's subscribed/unsubscribed/cleaned. Empty means subscribed.",
    ),
  createdAt: z
    .string()
    .optional()
    .describe("Original signup date; kept as the contact's createdAt"),
  customFields: customFieldsSchema.optional(),
  /** Echoed back in `skipped` so callers can point at the CSV line. */
  row: z.number().int().optional(),
});

export const importContactsBodySchema = z.object({
  contacts: z.array(importContactRowSchema).min(1).max(1000),
  tags: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Added to every imported contact"),
  pending: z
    .enum(["skip", "unsubscribed"])
    .optional()
    .describe(
      "Contacts who never confirmed (Pending / Needs approval): skip them (default) or import them unsubscribed with the `pending` tag",
    ),
  source: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Where the rows came from, e.g. the CSV file name; kept in the audit log",
    ),
});

export const importContactsResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  /** Imported as bounced/complained and added to the suppression list. */
  suppressed: z.number().int(),
  skipped: z.array(
    z.object({
      row: z.number().int().optional(),
      email: z.string(),
      reason: z.enum([
        "invalid_email",
        "duplicate",
        "pending_confirmation",
        "unknown_status",
        "plan_limit_reached",
      ]),
    }),
  ),
});

export const exportContactsQuerySchema = z.object({
  segmentId: z.string().optional().describe("Only export this saved segment"),
  filter: z
    .string()
    .optional()
    .describe("Serialized ContactFilterWithAggregator JSON; combines with segmentId"),
});

export type ImportContactRow = z.infer<typeof importContactRowSchema>;
export type ImportContactsResult = z.infer<typeof importContactsResultSchema>;

/** Which contacts a bulk delete targets: an explicit list, or every
 * contact matching a search, saved segment and/or filter (combined with AND;
 * an empty `match` means every contact in the team). */
export const contactSelectionObjectSchema = z.object({
  contactIds: z
    .array(z.string().min(1))
    .min(1)
    .max(1000)
    .optional()
    .describe("Contact IDs, up to 1000. Unknown IDs are ignored."),
  match: z
    .object({
      q: z.string().optional().describe("Search term matched against email or name"),
      segmentId: z.string().optional().describe("Only contacts in this saved segment"),
      filter: contactFilterSchema
        .optional()
        .describe("Inline ContactFilterWithAggregator; combines with q and segmentId"),
    })
    .optional()
    .describe(
      "Every contact matching q, segmentId and filter (AND). `{}` selects every contact in the team.",
    ),
});

const exactlyOneSelection = (body: { contactIds?: unknown; match?: unknown }) =>
  Boolean(body.contactIds) !== Boolean(body.match);
const exactlyOneSelectionMessage = {
  message: "Pass exactly one of contactIds or match",
};

export const contactSelectionSchema = contactSelectionObjectSchema.refine(
  exactlyOneSelection,
  exactlyOneSelectionMessage,
);

export const previewContactDeletionResultSchema = z.object({
  count: z.number().int().describe("Contacts that would be deleted right now"),
  unsubscribed: z
    .number()
    .int()
    .describe(
      "How many of them are unsubscribed; their addresses are added to the suppression list",
    ),
});

export const deleteContactsObjectSchema = contactSelectionObjectSchema.extend({
  expectedCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "The count from the preview. Required with match: if the live count differs, nothing is deleted and the response is 409 count_changed.",
    ),
});

export const deleteContactsBodySchema = deleteContactsObjectSchema
  .refine(exactlyOneSelection, exactlyOneSelectionMessage)
  .refine((body) => !body.match || body.expectedCount !== undefined, {
    message: "expectedCount is required with match",
    path: ["expectedCount"],
  });

export const contactDeletionSchema = z.object({
  deletionId: z
    .string()
    .nullable()
    .describe("Background job id for large deletions; null when it ran inline"),
  status: z.enum(["queued", "running", "completed", "failed"]),
  count: z.number().int().describe("Contacts selected for deletion"),
  deleted: z.number().int().describe("Contacts deleted so far"),
  suppressed: z
    .number()
    .int()
    .describe("Unsubscribed addresses newly added to the suppression list"),
});

export type ContactSelection = z.infer<typeof contactSelectionSchema>;
export type DeleteContactsBody = z.infer<typeof deleteContactsBodySchema>;
export type ContactDeletion = z.infer<typeof contactDeletionSchema>;
